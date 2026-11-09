import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { load } from 'cheerio';

import { validateFile } from './file-validator.js';
import { runProcess } from './process-runner.js';
import { discoverTools } from './tool-discovery.js';

const PROPERTY_NAMES = [
  'Configuration',
  'Platform',
  'PlatformToolset',
  'WindowsTargetPlatformVersion',
  'OutDir',
  'IntDir',
  'TargetPath',
  'TargetName',
  'TargetExt',
  'VCInstallDir',
  'VCToolsVersion',
  'WindowsSdkDir',
  'UserRootDir',
  'VCTargetsPath',
  'LibraryPath',
  'IncludePath',
  'ExecutablePath'
];

const MAX_XML_BYTES = 30 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

function parseMsbuildJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.Properties || parsed;
  } catch {
    throw new Error('无法解析 MSBuild -getProperty 返回的 JSON。');
  }
}

function conditionMatches(condition, configuration, platform) {
  const text = String(condition || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();

  const parts = text.split('==');
  if (parts.length !== 2) return false;

  const left = parts[0]
    .split('')
    .filter(ch => ch !== "'" && ch !== '"' && ch.charCodeAt(0) > 32)
    .join('')
    .toLowerCase();

  if (left !== '$(configuration)|$(platform)') return false;

  let right = parts[1].trim();

  if (
    right.length >= 2 &&
    ((right[0] === "'" && right.at(-1) === "'") ||
     (right[0] === '"' && right.at(-1) === '"'))
  ) {
    right = right.slice(1, -1);
  } else {
    return false;
  }

  const values = right.split('|').map(value => value.trim().toLowerCase());

  return values.length === 2 &&
    values[0] === String(configuration).trim().toLowerCase() &&
    values[1] === String(platform).trim().toLowerCase();
}
function splitValues(value) {
  return String(value || '')
    .split(';')
    .map(item => item.trim())
    .filter(Boolean);
}

function readLinkGroups(xml, configuration, platform) {
  const $ = load(xml, { xmlMode: true });
  const groups = [];

  $('ItemDefinitionGroup').each((_, element) => {
    const condition = $(element).attr('Condition') || '';

    if (!conditionMatches(condition, configuration, platform)) {
      return;
    }

    const link = $(element).children('Link').first();

    if (!link.length) {
      return;
    }

    const read = name => link.children(name).first().text().trim();

    groups.push({
      condition,
      additionalDependencies: splitValues(
        read('AdditionalDependencies')
      ),
      additionalLibraryDirectories: splitValues(
        read('AdditionalLibraryDirectories')
      ),
      moduleDefinitionFile: read('ModuleDefinitionFile') || null,
      targetMachine: read('TargetMachine') || null,
      raw: {
        additionalDependencies: read('AdditionalDependencies'),
        additionalLibraryDirectories: read('AdditionalLibraryDirectories'),
        moduleDefinitionFile: read('ModuleDefinitionFile')
      }
    });
  });

  return groups;
}

function parsePropertyList(stdout) {
  const properties = parseMsbuildJson(stdout);
  const result = {};

  for (const name of PROPERTY_NAMES) {
    const value = properties[name];
    result[name] = value === undefined ? null : value;
  }

  return result;
}

async function checkedProcess(runProcessFn, executable, args, label) {
  const result = await runProcessFn(executable, args, {
    timeoutMs: 60000,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    encoding: 'utf8'
  });

  if (result.timedOut) {
    throw new Error(`${label}执行超时。`);
  }

  if (result.truncated) {
    throw new Error(`${label}输出超过限制，无法可靠分析。`);
  }

  if (result.code !== 0) {
    throw new Error(
      `${label}失败，退出代码：${result.code}。\n${result.stderr || result.stdout}`
    );
  }

  return result.stdout;
}

/**
 * 只读检查 Visual Studio C++ 工程的 MSBuild 属性和链接配置。
 *
 * 不执行 Build、Rebuild、Clean 或其他编译目标。
 *
 * dependencies 用于测试时注入工具发现、进程执行和临时目录操作。
 */
export async function inspectMsbuildProject(
  projectFile,
  options = {},
  dependencies = {}
) {
  const {
    configuration = 'Release',
    platform = 'x64'
  } = options;

  const {
    discoverToolsFn = discoverTools,
    runProcessFn = runProcess,
    createTempDirFn = () =>
      mkdtemp(path.join(os.tmpdir(), 'objectarx-msbuild-inspect-')),
    removeTempDirFn = directory =>
      rm(directory, { recursive: true, force: true })
  } = dependencies;

  if (!['Debug', 'Release'].includes(configuration)) {
    return {
      success: false,
      stage: 'VALIDATE_INPUT',
      error: 'configuration 目前只接受 Debug 或 Release。'
    };
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(platform)) {
    return {
      success: false,
      stage: 'VALIDATE_INPUT',
      error: 'platform 参数格式无效。'
    };
  }

  const validation = validateFile(projectFile, 'project');

  if (!validation.valid || !/\.vcxproj$/i.test(validation.path || '')) {
    return {
      success: false,
      stage: 'VALIDATE_PROJECT',
      error: validation.error || '必须提供 .vcxproj 工程文件。',
      details: validation
    };
  }

  const tools = discoverToolsFn();

  if (!tools.msbuild?.found || !tools.msbuild.path) {
    return {
      success: false,
      stage: 'DISCOVER_MSBUILD',
      error: '未找到 MSBuild.exe。'
    };
  }

  const projectPath = validation.path;
  const projectDir = path.dirname(projectPath);
  const tempDir = await createTempDirFn();
  const expandedPath = path.join(tempDir, 'expanded.xml');

  const result = {
    success: false,
    readOnly: true,
    projectFile: projectPath,
    projectDirectory: projectDir,
    requestedConfiguration: configuration,
    requestedPlatform: platform,
    properties: null,
    linkConfigurations: [],
    diagnostics: [],
    evidence: [],
    limitations: [
      'MSBuild -getProperty 返回的是属性求值结果，不包含所有 ItemDefinition 元数据。',
      '预处理 XML 保留条件配置，但不等于最终 Link 任务命令行。',
      '本工具不会执行 Build、Rebuild 或 Clean。',
      '历史 TLOG 记录必须单独分析，不能直接视为当前构建状态。'
    ]
  };

  try {
    const propertyArgs = [
      '-getProperty:' + PROPERTY_NAMES.join(','),
      `-property:Configuration=${configuration}`,
      `-property:Platform=${platform}`,
      '-nologo',
      projectPath
    ];

    const propertyOutput = await checkedProcess(
      runProcessFn,
      tools.msbuild.path,
      propertyArgs,
      'MSBuild 属性求值'
    );

    result.properties = parsePropertyList(propertyOutput);

    result.evidence.push({
      source: 'MSBUILD_GET_PROPERTY',
      level: 'VERIFIED',
      description: '由 MSBuild 返回当前指定配置的属性求值结果。'
    });

    const preprocessArgs = [
      `-pp:${expandedPath}`,
      `-property:Configuration=${configuration}`,
      `-property:Platform=${platform}`,
      '-nologo',
      projectPath
    ];

    await checkedProcess(
      runProcessFn,
      tools.msbuild.path,
      preprocessArgs,
      'MSBuild 项目预处理'
    );

    if (!fs.existsSync(expandedPath)) {
      throw new Error('MSBuild 未生成预处理 XML 文件。');
    }

    const stat = fs.statSync(expandedPath);

    if (stat.size > MAX_XML_BYTES) {
      throw new Error(
        `预处理 XML 超过大小限制：${stat.size} bytes。`
      );
    }

    const xml = fs.readFileSync(expandedPath, 'utf8');

    result.linkConfigurations = readLinkGroups(
      xml,
      configuration,
      platform
    );

    if (result.linkConfigurations.length > 0) {
      result.evidence.push({
        source: 'MSBUILD_PREPROCESSED_XML',
        level: 'SUPPORTED',
        description: '在预处理 XML 中找到与指定配置条件匹配的 Link 元数据。'
      });
    } else {
      result.diagnostics.push({
        code: 'LINK_CONFIGURATION_NOT_FOUND',
        severity: 'warning',
        message: '未在预处理 XML 中找到匹配当前配置的平台链接配置。'
      });
    }

    result.preprocessedXml = {
      size: stat.size,
      parsedLinkGroupCount: result.linkConfigurations.length
    };

    result.success = true;
    result.stage = 'COMPLETED';

    return result;
  } catch (error) {
    result.stage = 'INSPECT_MSBUILD_PROJECT';
    result.error = error.message;
    return result;
  } finally {
    await removeTempDirFn(tempDir);
  }
}
