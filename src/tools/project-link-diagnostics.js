import { inspectMsbuildProject } from '../core/msbuild-inspector.js';
import { parseLinkLog } from '../core/link-log-parser.js';
import { traceSymbolInLibraries } from './symbol-trace-runner.js';

const DEFAULT_CONFIGURATION = 'Release';
const DEFAULT_PLATFORM = 'x64';

function addUnique(target, items) {
  for (const item of items || []) {
    if (!target.includes(item)) target.push(item);
  }
}

function buildRootCauseCandidates(linkErrors, symbolTrace) {
  const candidates = [];

  for (const error of linkErrors?.errors || []) {
    if (error.code === 'LNK2019' || error.code === 'LNK2001') {
      candidates.push({
        type: 'UNRESOLVED_EXTERNAL_SYMBOL',
        code: error.code,
        symbol: error.symbol,
        referencedBy: error.referencedBy,
        description: error.symbol
          ? `Linker reported unresolved symbol: ${error.symbol}`
          : 'Linker reported an unresolved external symbol.',
        evidenceLevel: 'LOG_CONFIRMED'
      });
    }

    if (error.code === 'LNK1104') {
      candidates.push({
        type: 'MISSING_INPUT_FILE',
        code: error.code,
        inputFile: error.inputFile,
        description: error.inputFile
          ? `Linker reported an unavailable input file: ${error.inputFile}`
          : 'Linker reported that an input file could not be opened.',
        evidenceLevel: 'LOG_CONFIRMED'
      });
    }

    if (error.code === 'LNK1120') {
      candidates.push({
        type: 'UNRESOLVED_EXTERNAL_COUNT',
        code: error.code,
        unresolvedCount: error.unresolvedCount,
        description: `Linker reported unresolved external count: ${error.unresolvedCount ?? 'unknown'}`,
        evidenceLevel: 'LOG_CONFIRMED'
      });
    }
  }

  for (const item of symbolTrace?.trace?.traces || []) {
    if (item.status === 'NOT_FOUND') {
      candidates.push({
        type: 'SYMBOL_NOT_FOUND_IN_PROVIDED_LIBRARIES',
        symbol: item.symbol,
        description: `Symbol not found in the supplied LIB indexes: ${item.symbol}`,
        evidenceLevel: 'LIB_INDEX_NOT_FOUND'
      });
    }

    if (item.status === 'MEMBER_OBJ_MISSING') {
      candidates.push({
        type: 'LIB_MEMBER_OBJECT_UNAVAILABLE',
        symbol: item.symbol,
        description: 'A candidate member exists in the LIB index, but its OBJ could not be obtained or analyzed.',
        evidenceLevel: 'MEMBER_EXTRACTION_INCOMPLETE'
      });
    }

    if (item.status === 'INDEX_MATCH_ONLY') {
      candidates.push({
        type: 'LIB_INDEX_MATCH_WITHOUT_VERIFIED_DEFINITION',
        symbol: item.symbol,
        description: 'A LIB index match exists, but the member OBJ definition has not been verified.',
        evidenceLevel: 'LIB_INDEX_MATCH_ONLY'
      });
    }

    if (item.status === 'MEMBER_INDEX_OUT_OF_RANGE') {
      candidates.push({
        type: 'LIB_MEMBER_INDEX_OUT_OF_RANGE',
        symbol: item.symbol,
        description: 'The LIB symbol index references a member outside the available member list.',
        evidenceLevel: 'LIB_INDEX_INCONSISTENCY'
      });
    }

    if (item.status === 'INDEXED_MEMBER_NOT_OBJ') {
      candidates.push({
        type: 'LIB_INDEXED_MEMBER_NOT_OBJ',
        symbol: item.symbol,
        description: 'The LIB index points to a member that is not an OBJ file.',
        evidenceLevel: 'LIB_MEMBER_TYPE_MISMATCH'
      });
    }
  }

  return candidates;
}
function determineOverallStatus(buildAnalysis, projectInspection, symbolTrace) {
  if (
    buildAnalysis?.buildStatus === 'FAILED' ||
    buildAnalysis?.linkStatus === 'FAILED'
  ) {
    return 'FAILED';
  }

  if (
    buildAnalysis?.buildStatus === 'SUCCEEDED' &&
    buildAnalysis?.linkStatus === 'SUCCEEDED'
  ) {
    // 日志不能证明最终产物实际存在，因此不能据此判定整体成功。
    return 'PARTIAL';
  }

  if (
    projectInspection?.success ||
    symbolTrace?.success ||
    buildAnalysis?.success
  ) {
    return 'PARTIAL';
  }

  return 'UNKNOWN';
}

/**
 * Aggregate read-only ObjectARX project and linker diagnostics.
 *
 * dependencies:
 * {
 *   inspectMsbuildProjectFn,
 *   parseLinkLogFn,
 *   traceSymbolInLibrariesFn,
 *   msbuildDependencies,
 *   symbolTraceDependencies
 * }
 */
export async function analyzeProjectLink(input = {}, dependencies = {}) {
  const {
    projectFile,
    configuration = DEFAULT_CONFIGURATION,
    platform = DEFAULT_PLATFORM,
    stdout,
    stderr,
    exitCode = null,
    timedOut = false,
    truncated = false,
    sourceObjPath,
    libraryPaths
  } = input;

  const inspectProject =
    dependencies.inspectMsbuildProjectFn || inspectMsbuildProject;
  const parseLog =
    dependencies.parseLinkLogFn || parseLinkLog;
  const traceSymbols =
    dependencies.traceSymbolInLibrariesFn || traceSymbolInLibraries;

  const report = {
    success: true,
    project: {
      projectFile: projectFile || null,
      configuration,
      platform
    },
    projectInspection: null,
    buildAnalysis: null,
    linkErrors: null,
    symbolTrace: null,
    overallStatus: 'UNKNOWN',
    rootCauseCandidates: [],
    evidence: [],
    limitations: [
      '本工具不执行 MSBuild Build、Rebuild 或 Clean。',
      'MSBuild 属性求值和预处理可能在系统临时目录创建文件，结束后会清理。',
      'LIB 符号追踪可能在系统临时目录提取成员 OBJ，结束后会清理。',
      '日志中的输出文件路径不代表文件实际存在。',
      '符号在 LIB 中存在不代表最终链接一定成功。',
      '本工具不修改用户工程、SDK、OBJ、LIB 或知识库。',
      '不自动扫描工程目录，也不推测未提供的 OBJ 或 LIB。'
    ],
    recommendations: []
  };

  if (typeof projectFile !== 'string' || !projectFile.trim()) {
    return {
      ...report,
      success: false,
      error: 'projectFile 必须是非空工程文件路径。',
      overallStatus: 'UNKNOWN'
    };
  }

  if (!['Debug', 'Release'].includes(configuration)) {
    return {
      ...report,
      success: false,
      error: 'configuration 仅支持 Debug 或 Release。',
      overallStatus: 'UNKNOWN'
    };
  }

  if (typeof platform !== 'string' || !platform.trim()) {
    return {
      ...report,
      success: false,
      error: 'platform 必须是非空字符串。',
      overallStatus: 'UNKNOWN'
    };
  }

  if (libraryPaths !== undefined && !Array.isArray(libraryPaths)) {
    return {
      ...report,
      success: false,
      error: 'libraryPaths 必须是字符串数组。',
      overallStatus: 'UNKNOWN'
    };
  }

  if (Array.isArray(libraryPaths)) {
    if (
      libraryPaths.length < 1 ||
      libraryPaths.length > 10 ||
      libraryPaths.some(item =>
        typeof item !== 'string' || !item.trim()
      )
    ) {
      return {
        ...report,
        success: false,
        error: 'libraryPaths 必须包含 1 至 10 个非空路径。',
        overallStatus: 'UNKNOWN'
      };
    }
  }

  if (sourceObjPath && !libraryPaths?.length) {
    return {
      ...report,
      success: false,
      error: '提供 sourceObjPath 时，必须同时提供 libraryPaths。',
      overallStatus: 'UNKNOWN'
    };
  }

  if (libraryPaths?.length && !sourceObjPath) {
    return {
      ...report,
      success: false,
      error: '提供 libraryPaths 时，必须同时提供 sourceObjPath。',
      overallStatus: 'UNKNOWN'
    };
  }

  try {
    report.projectInspection = await inspectProject(
      projectFile,
      { configuration, platform },
      dependencies.msbuildDependencies || {}
    );

    if (report.projectInspection?.evidence) {
      addUnique(report.evidence, report.projectInspection.evidence);
    }
  } catch (error) {
    report.projectInspection = {
      success: false,
      error: error.message || String(error)
    };
  }

  const hasLog =
    typeof stdout === 'string' ||
    typeof stderr === 'string' ||
    exitCode !== null ||
    timedOut ||
    truncated;

  if (hasLog) {
    try {
      report.buildAnalysis = parseLog({
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr,
        exitCode,
        timedOut,
        truncated
      });

      if (report.buildAnalysis?.success) {
        report.linkErrors = {
          success: true,
          errors: report.buildAnalysis.errors,
          summary: report.buildAnalysis.errorSummary
        };

        addUnique(report.evidence, report.buildAnalysis.evidence);
        addUnique(report.limitations, report.buildAnalysis.limitations);
      }
    } catch (error) {
      report.buildAnalysis = {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  if (sourceObjPath && libraryPaths?.length) {
    try {
      report.symbolTrace = await traceSymbols(
        sourceObjPath,
        libraryPaths,
        dependencies.symbolTraceDependencies || {}
      );

      if (report.symbolTrace?.trace?.evidenceLevel) {
        addUnique(report.evidence, [`Symbol trace evidence level: ${report.symbolTrace.trace.evidenceLevel}`]);
      }

      if (report.symbolTrace?.limitations) {
        addUnique(report.limitations, report.symbolTrace.limitations);
      }
    } catch (error) {
      report.symbolTrace = {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  report.rootCauseCandidates = buildRootCauseCandidates(
    report.linkErrors,
    report.symbolTrace
  );

  report.overallStatus = determineOverallStatus(
    report.buildAnalysis,
    report.projectInspection,
    report.symbolTrace
  );

  const attemptedDiagnostics = [
    report.projectInspection,
    report.buildAnalysis,
    report.symbolTrace
  ].filter(item => item !== null);

  report.success =
    attemptedDiagnostics.length > 0 &&
    attemptedDiagnostics.every(item => item?.success === true);

  if (report.rootCauseCandidates.length > 0) {
    report.recommendations.push(
      '优先核对报告中的链接错误、缺失输入文件和未解析符号。'
    );
  }

  if (!report.buildAnalysis) {
    report.recommendations.push(
      '如需判断构建结果，请提供完整 MSBuild 输出日志及进程退出代码。'
    );
  }

  if (!report.symbolTrace && report.buildAnalysis?.linkStatus === 'FAILED') {
    report.recommendations.push(
      '如需追踪具体符号，可明确提供报错源 OBJ 和需要检查的 LIB 路径。'
    );
  }

  if (report.projectInspection?.success === false) {
    report.recommendations.push(
      '请先解决工程文件验证、MSBuild 工具发现或属性求值阶段的问题。'
    );
  }

  if (report.overallStatus === 'PARTIAL') {
    report.recommendations.push(
      '当前证据不足以确认最终 ARX/DLL 产物，仍需独立验证输出文件。'
    );
  }

  return report;
}


