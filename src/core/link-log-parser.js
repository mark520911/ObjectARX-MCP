import { parseLinkErrors } from './link-error-parser.js';

const unique = values => [...new Set(values)];

function getLines(text) {
  return String(text || '').split(/\r?\n/);
}

function hasBuildSuccess(lines) {
  return lines.some(line =>
    /\bBuild succeeded\b/i.test(line) ||
    /\bRebuild All succeeded\b/i.test(line)
  );
}

function hasBuildFailure(lines) {
  return lines.some(line =>
    /\bBuild FAILED\b/i.test(line) ||
    /\bRebuild All failed\b/i.test(line)
  );
}

function isLinkStageLine(line) {
  return (
    /^\s*Linking\b/i.test(line) ||
    /^\s*Link\s*:/i.test(line) ||
    /\blink\.exe\b/i.test(line) ||
    /\bMicrosoft\s+\(R\)\s+Incremental\s+Linker\b/i.test(line)
  );
}

function isLinkFailureLine(line) {
  return (
    /\bLNK\d{4}\b/i.test(line) ||
    /^\s*LINK\s*:\s*fatal error\b/i.test(line) ||
    /\blink\.exe\b.*(?:failed|error)/i.test(line)
  );
}

function extractLinkCommands(lines) {
  return unique(
    lines
      .filter(line =>
        /\blink\.exe\b/i.test(line) ||
        /^\s*Link\s*:/i.test(line)
      )
      .map(line => line.trim())
  );
}

function extractFiles(lines, extensionPattern) {
  const files = [];

  for (const line of lines) {
    const matches = line.match(
      /"[^"]+\.(?:obj|lib|dll|arx|exe)"/gi
    ) || [];

    for (const match of matches) {
      const file = match.slice(1, -1);

      if (extensionPattern.test(file)) {
        files.push(file);
      }
    }
  }

  return unique(files);
}

/**
 * Parse an MSBuild build log without executing any process.
 *
 * Input:
 * {
 *   stdout: string,
 *   stderr: string,
 *   exitCode: number | null,
 *   timedOut: boolean,
 *   truncated: boolean
 * }
 */
export function parseLinkLog(input = {}) {
  const {
    stdout = '',
    stderr = '',
    exitCode = null,
    timedOut = false,
    truncated = false
  } = input;

  if (
    typeof stdout !== 'string' ||
    typeof stderr !== 'string' ||
    (exitCode !== null && !Number.isInteger(exitCode))
  ) {
    return {
      success: false,
      error: 'Invalid input: stdout/stderr must be strings and exitCode must be an integer or null.'
    };
  }

  const combined = [stdout, stderr].filter(Boolean).join('\n');
  const lines = getLines(combined);

  const linkErrors = parseLinkErrors(combined);
  const errors = linkErrors.errors;

  const linkStageLines = lines.filter(isLinkStageLine);
  const linkFailureLines = lines.filter(isLinkFailureLine);

  const linkCommands = extractLinkCommands(lines);
  const outputFiles = extractFiles(
    lines,
    /\.(?:dll|arx|exe)$/i
  );
  const inputFiles = extractFiles(
    lines,
    /\.(?:obj|lib)$/i
  );

  const explicitBuildSuccess = hasBuildSuccess(lines);
  const explicitBuildFailure = hasBuildFailure(lines);

  const incomplete = Boolean(timedOut || truncated);

  let buildStatus = 'UNKNOWN';

  if (!incomplete) {
    if (explicitBuildFailure || exitCode !== null && exitCode !== 0) {
      buildStatus = 'FAILED';
    } else if (
      explicitBuildSuccess &&
      exitCode === 0
    ) {
      buildStatus = 'SUCCEEDED';
    }
  }

  let linkStatus = 'UNKNOWN';

  if (!incomplete) {
    if (errors.length > 0 || linkFailureLines.length > 0) {
      linkStatus = 'FAILED';
    } else if (buildStatus === 'SUCCEEDED') {
      linkStatus = linkStageLines.length > 0
        ? 'SUCCEEDED'
        : 'SKIPPED';
    } else if (
      linkStageLines.length === 0 &&
      buildStatus === 'FAILED'
    ) {
      linkStatus = 'SKIPPED';
    }
  }

  const stages = [];

  if (lines.some(line => /\bCompile\b|\bCompiling\b|\bCL\.exe\b/i.test(line))) {
    stages.push('COMPILE');
  }

  if (linkStageLines.length > 0) {
    stages.push('LINK');
  }

  const warnings = unique(
    lines
      .filter(line => /\bwarning\s+(?:LNK\d{4}|C\d{4})\b/i.test(line))
      .map(line => line.trim())
  );

  const evidence = [];

  if (explicitBuildSuccess) {
    evidence.push({
      source: 'MSBUILD_BUILD_SUCCESS_MESSAGE',
      level: 'SUPPORTED',
      description: '日志中出现 MSBuild 构建成功标记。'
    });
  }

  if (explicitBuildFailure) {
    evidence.push({
      source: 'MSBUILD_BUILD_FAILURE_MESSAGE',
      level: 'SUPPORTED',
      description: '日志中出现 MSBuild 构建失败标记。'
    });
  }

  if (exitCode !== null) {
    evidence.push({
      source: 'PROCESS_EXIT_CODE',
      level: 'VERIFIED',
      description: `进程退出代码为 ${exitCode}。`
    });
  }

  if (linkStageLines.length > 0) {
    evidence.push({
      source: 'LINK_STAGE_LOG',
      level: 'SUPPORTED',
      description: '日志中发现链接阶段线索。'
    });
  }

  if (errors.length > 0) {
    evidence.push({
      source: 'LINK_ERROR_PARSER',
      level: 'VERIFIED',
      description: `链接错误解析器识别出 ${errors.length} 条错误。`
    });
  }

  if (timedOut) {
    evidence.push({
      source: 'PROCESS_TIMEOUT',
      level: 'VERIFIED',
      description: '进程执行超时，构建结果不完整。'
    });
  }

  if (truncated) {
    evidence.push({
      source: 'OUTPUT_TRUNCATED',
      level: 'VERIFIED',
      description: '日志输出被截断，无法确认最终结果。'
    });
  }

  const limitations = [
    '链接命令或链接阶段标记只能证明存在链接线索，不能单独证明 DLL 已成功生成。',
    '输出文件路径来自日志文本，不代表文件实际存在。',
    '历史 TLOG 和历史构建日志不能直接证明当前构建状态。',
    '本解析器不执行 MSBuild，也不验证生成文件。'
  ];

  if (linkStatus === 'UNKNOWN') {
    limitations.push('当前日志证据不足，无法确认链接阶段最终结果。');
  }

  if (incomplete) {
    limitations.push('进程超时或日志截断，状态判断受到限制。');
  }

  return {
    success: true,
    buildStatus,
    linkStatus,
    stages,
    linkCommands,
    outputFiles,
    inputFiles,
    errors,
    errorSummary: linkErrors.summary,
    warnings,
    evidence,
    limitations,
    process: {
      exitCode,
      timedOut: Boolean(timedOut),
      truncated: Boolean(truncated)
    },
    rawLog: combined
  };
}
