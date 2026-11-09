import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectMsbuildProject } from '../src/core/msbuild-inspector.js';

const properties = {
  Configuration: 'Release',
  Platform: 'x64',
  PlatformToolset: 'v143',
  WindowsTargetPlatformVersion: '10.0',
  OutDir: 'bin\\Release\\x64\\',
  IntDir: 'obj\\Release\\x64\\',
  TargetPath: 'bin\\Release\\x64\\Demo.arx',
  TargetName: 'Demo',
  TargetExt: '.arx',
  VCInstallDir: 'C:\\VisualStudio\\VC\\',
  VCToolsVersion: '14.44.35207',
  WindowsSdkDir: 'C:\\Windows Kits\\10\\',
  UserRootDir: 'C:\\Users\\Test\\',
  VCTargetsPath: 'C:\\MSBuild\\',
  LibraryPath: 'C:\\SDK\\lib-x64',
  IncludePath: 'C:\\SDK\\inc',
  ExecutablePath: 'C:\\Tools'
};

const expandedXml = `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <ItemDefinitionGroup Condition="'$(Configuration)|$(Platform)'=='Debug|x64'">
    <Link>
      <AdditionalDependencies>debug.lib;%(AdditionalDependencies)</AdditionalDependencies>
      <AdditionalLibraryDirectories>C:\\SDK\\debug;%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories>
      <ModuleDefinitionFile>C:\\SDK\\inc\\Debug.def</ModuleDefinitionFile>
      <TargetMachine>MachineX64</TargetMachine>
    </Link>
  </ItemDefinitionGroup>
  <ItemDefinitionGroup Condition="'$(Configuration)|$(Platform)'=='Release|x64'">
    <Link>
      <AdditionalDependencies>acad.lib;rxapi.lib;%(AdditionalDependencies)</AdditionalDependencies>
      <AdditionalLibraryDirectories>C:\\SDK\\lib-x64;%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories>
      <ModuleDefinitionFile>C:\\SDK\\inc\\AcRxDefault.def</ModuleDefinitionFile>
      <TargetMachine>MachineX64</TargetMachine>
    </Link>
  </ItemDefinitionGroup>
</Project>`;

async function createFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'msbuild-inspector-test-')
  );
  const projectFile = path.join(directory, 'Demo.vcxproj');
  fs.writeFileSync(projectFile, '<Project />', 'utf8');

  return {
    directory,
    projectFile,
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

function createDependencies(options = {}) {
  const calls = [];
  let tempDirectory;
  let cleanupCalled = false;

  const dependencies = {
    discoverToolsFn: () => ({
      msbuild: {
        found: true,
        path: 'C:\\Fake\\MSBuild.exe'
      }
    }),

    createTempDirFn: async () => {
      tempDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'msbuild-inspector-output-')
      );
      return tempDirectory;
    },

    removeTempDirFn: async directory => {
      cleanupCalled = true;
      fs.rmSync(directory, { recursive: true, force: true });
    },

    runProcessFn: async (executable, args, processOptions) => {
      calls.push({ executable, args, processOptions });

      if (options.processError) {
        throw new Error(options.processError);
      }

      if (args.some(arg =>
        /(^|-)(build|rebuild|clean)(:|$)/i.test(arg)
      )) {
        throw new Error('检测到禁止的构建命令。');
      }

      if (args.some(arg => arg.startsWith('-getProperty:'))) {
        if (options.propertyResult) {
          return options.propertyResult;
        }

        return {
          code: 0,
          signal: null,
          timedOut: false,
          truncated: false,
          stdout: JSON.stringify({ Properties: properties }),
          stderr: ''
        };
      }

      const ppArg = args.find(arg => arg.startsWith('-pp:'));

      if (ppArg) {
        const outputPath = ppArg.slice(4);

        if (options.preprocessResult) {
          return options.preprocessResult;
        }

        fs.writeFileSync(
          outputPath,
          options.xml || expandedXml,
          'utf8'
        );

        return {
          code: 0,
          signal: null,
          timedOut: false,
          truncated: false,
          stdout: '',
          stderr: ''
        };
      }

      throw new Error('收到未预期的 MSBuild 参数。');
    }
  };

  return {
    dependencies,
    calls,
    get tempDirectory() {
      return tempDirectory;
    },
    get cleanupCalled() {
      return cleanupCalled;
    }
  };
}

test('Release|x64：提取当前配置的链接库和 DEF 文件', async () => {
  const fixture = await createFixture();
  const mock = createDependencies();

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      { configuration: 'Release', platform: 'x64' },
      mock.dependencies
    );

    assert.equal(result.success, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.properties.PlatformToolset, 'v143');
    assert.equal(result.properties.VCToolsVersion, '14.44.35207');

    assert.equal(result.linkConfigurations.length, 1);

    const link = result.linkConfigurations[0];

    assert.deepEqual(
      link.additionalDependencies,
      ['acad.lib', 'rxapi.lib', '%(AdditionalDependencies)']
    );

    assert.deepEqual(
      link.additionalLibraryDirectories,
      ['C:\\SDK\\lib-x64', '%(AdditionalLibraryDirectories)']
    );

    assert.equal(
      link.moduleDefinitionFile,
      'C:\\SDK\\inc\\AcRxDefault.def'
    );

    assert.equal(link.targetMachine, 'MachineX64');
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.cleanupCalled, true);
  } finally {
    fixture.cleanup();
  }
});

test('Debug|x64：不混入 Release 链接配置', async () => {
  const fixture = await createFixture();
  const mock = createDependencies();

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      { configuration: 'Debug', platform: 'x64' },
      mock.dependencies
    );

    assert.equal(result.success, true);
    assert.equal(result.linkConfigurations.length, 1);

    assert.deepEqual(
      result.linkConfigurations[0].additionalDependencies,
      ['debug.lib', '%(AdditionalDependencies)']
    );

    assert.equal(
      result.linkConfigurations[0].moduleDefinitionFile,
      'C:\\SDK\\inc\\Debug.def'
    );
  } finally {
    fixture.cleanup();
  }
});

test('解析 MSBuild 实际求值属性', async () => {
  const fixture = await createFixture();
  const mock = createDependencies();

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      {},
      mock.dependencies
    );

    assert.equal(result.success, true);
    assert.equal(result.properties.TargetName, 'Demo');
    assert.equal(result.properties.TargetExt, '.arx');
    assert.equal(result.properties.OutDir, 'bin\\Release\\x64\\');
    assert.ok(
      result.evidence.some(item =>
        item.source === 'MSBUILD_GET_PROPERTY' &&
        item.level === 'VERIFIED'
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test('只执行属性求值和预处理，不执行构建目标', async () => {
  const fixture = await createFixture();
  const mock = createDependencies();

  try {
    await inspectMsbuildProject(
      fixture.projectFile,
      {},
      mock.dependencies
    );

    assert.equal(mock.calls.length, 2);

    for (const call of mock.calls) {
      assert.ok(call.args.includes('-nologo'));
      assert.ok(!call.args.some(arg =>
        /(^|-)(build|rebuild|clean)(:|$)/i.test(arg)
      ));
    }

    assert.ok(
      mock.calls.some(call =>
        call.args.some(arg => arg.startsWith('-getProperty:'))
      )
    );

    assert.ok(
      mock.calls.some(call =>
        call.args.some(arg => arg.startsWith('-pp:'))
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test('MSBuild 超时：返回失败结果并清理临时目录', async () => {
  const fixture = await createFixture();
  const mock = createDependencies({
    propertyResult: {
      code: null,
      signal: 'SIGTERM',
      timedOut: true,
      truncated: false,
      stdout: '',
      stderr: ''
    }
  });

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      {},
      mock.dependencies
    );

    assert.equal(result.success, false);
    assert.match(result.error, /超时/);
    assert.equal(mock.cleanupCalled, true);
  } finally {
    fixture.cleanup();
  }
});

test('MSBuild 非零退出：保留错误信息并清理临时目录', async () => {
  const fixture = await createFixture();
  const mock = createDependencies({
    propertyResult: {
      code: 1,
      signal: null,
      timedOut: false,
      truncated: false,
      stdout: '',
      stderr: 'MSB4019: 导入文件不存在'
    }
  });

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      {},
      mock.dependencies
    );

    assert.equal(result.success, false);
    assert.match(result.error, /MSB4019/);
    assert.equal(mock.cleanupCalled, true);
  } finally {
    fixture.cleanup();
  }
});

test('不合法工程文件：不启动 MSBuild', async () => {
  const fixture = await createFixture();
  const mock = createDependencies();

  try {
    const result = await inspectMsbuildProject(
      path.join(fixture.directory, 'missing.vcxproj'),
      {},
      mock.dependencies
    );

    assert.equal(result.success, false);
    assert.equal(result.stage, 'VALIDATE_PROJECT');
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.cleanupCalled, false);
  } finally {
    fixture.cleanup();
  }
});

test('预处理失败：仍清理临时目录', async () => {
  const fixture = await createFixture();
  const mock = createDependencies({
    preprocessResult: {
      code: 1,
      signal: null,
      timedOut: false,
      truncated: false,
      stdout: '',
      stderr: '预处理失败'
    }
  });

  try {
    const result = await inspectMsbuildProject(
      fixture.projectFile,
      {},
      mock.dependencies
    );

    assert.equal(result.success, false);
    assert.match(result.error, /预处理失败/);
    assert.equal(mock.cleanupCalled, true);
  } finally {
    fixture.cleanup();
  }
});
