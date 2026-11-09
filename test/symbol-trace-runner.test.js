import test from 'node:test';
import assert from 'node:assert/strict';

import { traceSymbolInLibraries } from '../src/tools/symbol-trace-runner.js';

const TEMP_DIR = 'C:/temp/objectarx-mcp-test';

function makeSourceResult(symbols = ['targetSymbol']) {
  return {
    success: true,
    file: {
      path: 'C:/test/source.obj',
      size: 100,
      modifiedAt: '2026-01-01T00:00:00.000Z'
    },
    analysis: {
      undefined: symbols.map(name => ({
        name,
        category: 'undefined',
        storageClass: 'External'
      }))
    }
  };
}

function makeLibraryResult({
  members = [
    {
      index: 1,
      name: 'provider.obj',
      isObj: true
    }
  ],
  symbols = [
    {
      memberIndex: 1,
      symbol: 'targetSymbol'
    }
  ]
} = {}) {
  return {
    success: true,
    file: {
      path: 'C:/test/provider.lib',
      size: 200,
      modifiedAt: '2026-01-01T00:00:00.000Z'
    },
    analysis: {
      memberCount: members.length,
      members,
      symbols
    }
  };
}

function makeDependencies(options = {}) {
  const calls = {
    inspectObj: [],
    inspectLib: [],
    process: [],
    createTemp: 0,
    removeTemp: []
  };

  const dependencies = {
    inspectObjFileFn: async file => {
      calls.inspectObj.push(file);
      return options.sourceResult ?? makeSourceResult();
    },

    inspectLibFileFn: async file => {
      calls.inspectLib.push(file);
      return options.libraryResult ?? makeLibraryResult();
    },

    discoverToolsFn: () => ({
      lib: {
        found: true,
        path: 'C:/tools/lib.exe'
      },
      dumpbin: {
        found: true,
        path: 'C:/tools/dumpbin.exe'
      }
    }),

    runProcessFn: async (executable, args) => {
      calls.process.push({ executable, args });

      if (options.processFailure) {
        return {
          code: 1,
          signal: null,
          timedOut: false,
          truncated: false,
          stdout: '',
          stderr: '模拟命令执行失败'
        };
      }

      if (args[0] === '/symbols') {
        return {
          code: 0,
          signal: null,
          timedOut: false,
          truncated: false,
          stdout: [
            '00D 00000000 SECT4 notype () External | targetSymbol'
          ].join('\n'),
          stderr: ''
        };
      }

      return {
        code: 0,
        signal: null,
        timedOut: false,
        truncated: false,
        stdout: '',
        stderr: ''
      };
    },

    createTempDirFn: async () => {
      calls.createTemp++;
      return TEMP_DIR;
    },

    removeTempDirFn: async dir => {
      calls.removeTemp.push(dir);
    }
  };

  return { dependencies, calls };
}

test('正常追踪：验证 LIB 成员 OBJ 中的 External 定义', async () => {
  const { dependencies, calls } = makeDependencies();

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    ['C:/test/provider.lib'],
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.trace.referenceCount, 1);
  assert.equal(result.trace.verifiedCount, 1);
  assert.equal(result.trace.unresolvedCount, 0);

  assert.equal(
    result.trace.traces[0].status,
    'DEFINITION_VERIFIED'
  );

  assert.equal(result.trace.traces[0].candidates[0].memberIndex, 1);
  assert.equal(calls.process.length, 2);
  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('源 OBJ 没有目标符号：不提取 LIB 成员', async () => {
  const { dependencies, calls } = makeDependencies({
    sourceResult: makeSourceResult([])
  });

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    ['C:/test/provider.lib'],
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.trace.referenceCount, 0);
  assert.equal(result.candidateCount, 0);
  assert.equal(calls.process.length, 0);
  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('LIB 存在重复成员名：不执行提取验证', async () => {
  const { dependencies, calls } = makeDependencies({
    libraryResult: makeLibraryResult({
      members: [
        { index: 1, name: 'duplicate.obj', isObj: true },
        { index: 2, name: 'duplicate.obj', isObj: true }
      ],
      symbols: [
        { memberIndex: 1, symbol: 'targetSymbol' }
      ]
    })
  });

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    ['C:/test/provider.lib'],
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.extractionProblemCount, 1);

  assert.equal(
    result.extractionProblems[0].stage,
    'DUPLICATE_MEMBER_NAME'
  );

  assert.equal(calls.process.length, 0);
  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('OBJ 提取命令失败：记录问题并清理临时目录', async () => {
  const { dependencies, calls } = makeDependencies({
    processFailure: true
  });

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    ['C:/test/provider.lib'],
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.extractionProblemCount, 1);

  assert.equal(
    result.extractionProblems[0].stage,
    'EXTRACT_OR_ANALYZE_MEMBER'
  );

  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('候选成员超过20个：触发数量限制', async () => {
  const members = [];
  const symbols = [];

  for (let i = 1; i <= 21; i++) {
    members.push({
      index: i,
      name: `provider-${i}.obj`,
      isObj: true
    });

    symbols.push({
      memberIndex: i,
      symbol: 'targetSymbol'
    });
  }

  const { dependencies, calls } = makeDependencies({
    libraryResult: makeLibraryResult({ members, symbols })
  });

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    ['C:/test/provider.lib'],
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.candidateCount, 20);
  assert.equal(result.candidateLimitReached, true);
  assert.equal(calls.process.length, 40);

  assert.ok(
    result.trace.limitations.some(item => item.includes('上限 20'))
  );

  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('临时目录创建后发生异常：仍然执行清理', async () => {
  const { dependencies, calls } = makeDependencies();

  dependencies.inspectLibFileFn = async () => {
    throw new Error('模拟 LIB 检查异常');
  };

  await assert.rejects(
    traceSymbolInLibraries(
      'C:/test/source.obj',
      ['C:/test/provider.lib'],
      dependencies
    ),
    /模拟 LIB 检查异常/
  );

  assert.deepEqual(calls.removeTemp, [TEMP_DIR]);
});

test('输入 LIB 数量超过限制：拒绝执行', async () => {
  const { dependencies, calls } = makeDependencies();

  const result = await traceSymbolInLibraries(
    'C:/test/source.obj',
    Array.from({ length: 11 }, (_, i) => `C:/test/${i}.lib`),
    dependencies
  );

  assert.equal(result.success, false);
  assert.equal(result.stage, 'VALIDATE_INPUT');
  assert.equal(calls.inspectObj.length, 0);
  assert.equal(calls.createTemp, 0);
});
