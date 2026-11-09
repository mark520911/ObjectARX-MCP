import { validateFile } from '../core/file-validator.js';
import { runProcess } from '../core/process-runner.js';
import { discoverTools } from '../core/tool-discovery.js';
import { analyzeLibText } from '../core/lib-parser.js';
import { analyzeObjText } from '../core/obj-parser.js';

function getRequiredTools() {
  const tools = discoverTools();

  if (!tools.lib.found) {
    throw new Error('没有找到 Visual Studio 的 lib.exe。');
  }

  if (!tools.dumpbin.found) {
    throw new Error('没有找到 Visual Studio 的 dumpbin.exe。');
  }

  return tools;
}

function getRequiredDumpbinTool() {
  const tools = discoverTools();

  if (!tools.dumpbin.found) {
    throw new Error('没有找到 Visual Studio 的 dumpbin.exe。');
  }

  return tools.dumpbin;
}

async function runChecked(executable, args, label) {
  const result = await runProcess(executable, args, {
    timeoutMs: 60000,
    maxOutputBytes: 20 * 1024 * 1024,
    encoding: 'utf8'
  });

  if (result.timedOut) {
    throw new Error(`${label} 执行超时。`);
  }

  if (result.truncated) {
    throw new Error(`${label} 输出超过限制，已截断，不能进行可靠分析。`);
  }

  if (result.code !== 0) {
    throw new Error(
      `${label} 执行失败，退出代码：${result.code}\n${result.stderr}`
    );
  }

  return result.stdout;
}

/**
 * 分析一个 LIB 文件。
 * 只读取文件，不修改原始 LIB。
 */
export async function inspectLibFile(inputPath) {
  const validation = validateFile(inputPath, 'lib');

  if (!validation.valid) {
    return {
      success: false,
      stage: 'VALIDATE_FILE',
      error: validation.error,
      path: validation.path ?? null
    };
  }

  try {
    const tools = getRequiredTools();

    const memberListText = await runChecked(
      tools.lib.path,
      ['/list', validation.path],
      'lib.exe /list'
    );

    const linkerMemberText = await runChecked(
      tools.dumpbin.path,
      ['/linkermember:2', validation.path],
      'dumpbin /linkermember:2'
    );

    const analysis = analyzeLibText(
      memberListText,
      linkerMemberText
    );

    return {
      success: true,
      file: {
        path: validation.path,
        size: validation.size,
        modifiedAt: validation.modifiedAt
      },
      tools: {
        lib: tools.lib.path,
        dumpbin: tools.dumpbin.path
      },
      analysis
    };
  } catch (error) {
    return {
      success: false,
      stage: 'ANALYZE_LIB',
      path: validation.path,
      error: error.message
    };
  }
}

/**
 * 分析一个 OBJ 文件。
 * 只读取文件，不修改原始 OBJ。
 */
export async function inspectObjFile(inputPath) {
  const validation = validateFile(inputPath, 'obj');

  if (!validation.valid) {
    return {
      success: false,
      stage: 'VALIDATE_FILE',
      error: validation.error,
      path: validation.path ?? null
    };
  }

  try {
    const dumpbin = getRequiredDumpbinTool();

    const symbolsText = await runChecked(
      dumpbin.path,
      ['/symbols', validation.path],
      'dumpbin /symbols'
    );

    const analysis = analyzeObjText(symbolsText);

    return {
      success: true,
      file: {
        path: validation.path,
        size: validation.size,
        modifiedAt: validation.modifiedAt
      },
      tools: {
        dumpbin: dumpbin.path
      },
      analysis
    };
  } catch (error) {
    return {
      success: false,
      stage: 'ANALYZE_OBJ',
      path: validation.path,
      error: error.message
    };
  }
}
