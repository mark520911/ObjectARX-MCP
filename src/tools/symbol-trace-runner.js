import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectLibFile, inspectObjFile } from './binary-analysis.js';
import { runProcess } from '../core/process-runner.js';
import { discoverTools } from '../core/tool-discovery.js';
import { analyzeObjText } from '../core/obj-parser.js';
import { traceSymbolReferences } from '../core/symbol-trace.js';

const MAX_CANDIDATES = 20;
const MAX_LIBRARIES = 10;

async function runChecked(executable, args, label, runProcessFn) {
  const result = await runProcessFn(executable, args, {
    timeoutMs: 60000,
    maxOutputBytes: 20 * 1024 * 1024,
    encoding: 'utf8'
  });

  if (result.timedOut) {
    throw new Error(`${label} 执行超时。`);
  }

  if (result.truncated) {
    throw new Error(`${label} 输出超过限制，无法可靠分析。`);
  }

  if (result.code !== 0) {
    throw new Error(
      `${label} 执行失败，退出代码：${result.code}\n${result.stderr}`
    );
  }

  return result.stdout;
}

/**
 * 自动追踪一个源 OBJ 的未定义符号。
 *
 * 第三个参数仅用于依赖注入和自动化测试。
 * 正常使用时不需要传入。
 */
export async function traceSymbolInLibraries(
  sourceObjPath,
  libraryPaths,
  dependencies = {}
) {
  const {
    inspectLibFileFn = inspectLibFile,
    inspectObjFileFn = inspectObjFile,
    runProcessFn = runProcess,
    discoverToolsFn = discoverTools,
    createTempDirFn = () =>
      mkdtemp(path.join(tmpdir(), 'objectarx-mcp-trace-')),
    removeTempDirFn = tempDir =>
      rm(tempDir, { recursive: true, force: true })
  } = dependencies;

  if (!Array.isArray(libraryPaths) ||
      libraryPaths.length < 1 ||
      libraryPaths.length > MAX_LIBRARIES) {
    return {
      success: false,
      stage: 'VALIDATE_INPUT',
      error: `libraryPaths 必须包含 1 至 ${MAX_LIBRARIES} 个 LIB 路径。`
    };
  }

  const sourceResult = await inspectObjFileFn(sourceObjPath);

  if (!sourceResult.success) {
    return {
      success: false,
      stage: 'INSPECT_SOURCE_OBJ',
      error: sourceResult.error,
      details: sourceResult
    };
  }

  const tools = discoverToolsFn();

  if (!tools.lib.found || !tools.dumpbin.found) {
    return {
      success: false,
      stage: 'DISCOVER_TOOLS',
      error: '自动追踪需要 lib.exe 和 dumpbin.exe。'
    };
  }

  const tempDir = await createTempDirFn();

  const libraries = [];
  const extractionProblems = [];
  let candidateCount = 0;
  let candidateLimitReached = false;

  try {
    for (let libIndex = 0; libIndex < libraryPaths.length; libIndex++) {
      const libraryPath = libraryPaths[libIndex];
      const libResult = await inspectLibFileFn(libraryPath);

      if (!libResult.success) {
        libraries.push({
          name: libraryPath,
          analysis: null
        });

        extractionProblems.push({
          library: libraryPath,
          stage: 'INSPECT_LIB',
          error: libResult.error
        });

        continue;
      }

      const analysis = libResult.analysis;
      const memberObjAnalyses = {};

      const references = new Set(
        sourceResult.analysis.undefined.map(item => item.name)
      );

      const matches = analysis.symbols.filter(
        item => references.has(item.symbol)
      );

      const candidateIndexes = [
        ...new Set(matches.map(item => item.memberIndex))
      ].sort((a, b) => a - b);

      for (const memberIndex of candidateIndexes) {
        if (candidateCount >= MAX_CANDIDATES) {
          candidateLimitReached = true;
          break;
        }

        const member = analysis.members[memberIndex - 1];

        if (!member || !member.isObj) {
          continue;
        }

        candidateCount++;

        const sameNameMembers = analysis.members.filter(
          item => item.name.toLowerCase() === member.name.toLowerCase()
        );

        if (sameNameMembers.length !== 1) {
          extractionProblems.push({
            library: libraryPath,
            memberIndex,
            memberName: member.name,
            stage: 'DUPLICATE_MEMBER_NAME',
            error: 'LIB 中存在同名成员，无法可靠确认提取结果对应的成员编号。'
          });
          continue;
        }

        const outputPath = path.join(
          tempDir,
          `lib-${libIndex + 1}-member-${memberIndex}.obj`
        );

        try {
          await runChecked(
            tools.lib.path,
            [
              '/nologo',
              `/extract:${member.name}`,
              `/out:${outputPath}`,
              libResult.file.path
            ],
            `提取 ${member.name}`,
            runProcessFn
          );

          const symbolsText = await runChecked(
            tools.dumpbin.path,
            ['/symbols', outputPath],
            `分析 ${member.name}`,
            runProcessFn
          );

          memberObjAnalyses[String(memberIndex)] = {
            memberName: member.name,
            analysis: analyzeObjText(symbolsText)
          };
        } catch (error) {
          extractionProblems.push({
            library: libraryPath,
            memberIndex,
            memberName: member.name,
            stage: 'EXTRACT_OR_ANALYZE_MEMBER',
            error: error.message
          });
        }
      }

      libraries.push({
        name: path.basename(libraryPath),
        analysis,
        memberObjAnalyses
      });

      if (candidateLimitReached) {
        break;
      }
    }

    const traceResult = traceSymbolReferences({
      sourceObjName: path.basename(sourceResult.file.path),
      sourceObjAnalysis: sourceResult.analysis,
      libraries
    });

    const limitations = [
      ...traceResult.limitations,
      ...extractionProblems.map(
        item => `${item.stage}: ${item.error}`
      )
    ];

    if (candidateLimitReached) {
      limitations.push(
        `候选成员数量达到上限 ${MAX_CANDIDATES}，后续成员未提取，分析不完整。`
      );
    }

    return {
      success: true,
      source: sourceResult.file,
      libraryCount: libraryPaths.length,
      candidateCount,
      candidateLimitReached,
      extractionProblemCount: extractionProblems.length,
      extractionProblems,
      trace: {
        ...traceResult,
        limitations
      },
      tools: {
        lib: tools.lib.path,
        dumpbin: tools.dumpbin.path
      },
      limitations: [
        '符号追踪是静态分析，不代表最终链接成功。',
        '重复成员名不会被自动认定为已验证定义。',
        '候选成员超过上限时，结果可能不完整。'
      ]
    };
  } finally {
    await removeTempDirFn(tempDir);
  }
}
