import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLinkLog } from '../src/core/link-log-parser.js';

test('构建成功且存在链接阶段', () => {
  const result = parseLinkLog({
    stdout: [
      'Build started.',
      '  Compiling main.cpp',
      '  Linking target.dll',
      'Build succeeded.'
    ].join('\n'),
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false
  });

  assert.equal(result.success, true);
  assert.equal(result.buildStatus, 'SUCCEEDED');
  assert.equal(result.linkStatus, 'SUCCEEDED');
});

test('链接错误应判定链接失败', () => {
  const result = parseLinkLog({
    stdout: [
      '  Linking target.dll',
      'main.obj : error LNK2019: unresolved external symbol testSymbol',
      'LINK : fatal error LNK1120: 1 unresolved externals',
      'Build FAILED.'
    ].join('\n'),
    stderr: '',
    exitCode: 1,
    timedOut: false,
    truncated: false
  });

  assert.equal(result.buildStatus, 'FAILED');
  assert.equal(result.linkStatus, 'FAILED');
  assert.ok(result.errors.length >= 1);
});

test('没有链接阶段时不得判定链接成功', () => {
  const result = parseLinkLog({
    stdout: [
      'Build started.',
      '  Compiling main.cpp',
      'Build succeeded.'
    ].join('\n'),
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: false
  });

  assert.equal(result.buildStatus, 'SUCCEEDED');
  assert.equal(result.linkStatus, 'SKIPPED');
});

test('只有链接命令线索但没有完成证据时，链接状态应未知', () => {
  const result = parseLinkLog({
    stdout: [
      'Build started.',
      '  Linking target.dll',
      'Build FAILED.'
    ].join('\n'),
    stderr: 'MSBuild stopped unexpectedly.',
    exitCode: 1,
    timedOut: false,
    truncated: false
  });

  assert.equal(result.buildStatus, 'FAILED');
  assert.equal(result.linkStatus, 'UNKNOWN');
});

test('进程超时时不得确认构建或链接成功', () => {
  const result = parseLinkLog({
    stdout: '  Linking target.dll',
    stderr: '',
    exitCode: null,
    timedOut: true,
    truncated: false
  });

  assert.equal(result.buildStatus, 'UNKNOWN');
  assert.equal(result.linkStatus, 'UNKNOWN');
});

test('日志截断时不得仅凭部分日志确认成功', () => {
  const result = parseLinkLog({
    stdout: 'Build succeeded.',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    truncated: true
  });

  assert.equal(result.buildStatus, 'UNKNOWN');
  assert.equal(result.linkStatus, 'UNKNOWN');
});

test('解析器应保留链接错误统计结果', () => {
  const result = parseLinkLog({
    stdout: [
      '  Linking target.dll',
      'main.obj : error LNK2019: unresolved external symbol testSymbol',
      'LINK : fatal error LNK1120: 1 unresolved externals',
      'Build FAILED.'
    ].join('\n'),
    stderr: '',
    exitCode: 1,
    timedOut: false,
    truncated: false
  });

  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length >= 1);
  assert.ok(result.evidence.length >= 1);
  assert.ok(Array.isArray(result.limitations));
});
