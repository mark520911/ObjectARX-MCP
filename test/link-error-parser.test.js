import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLinkErrors } from '../src/core/link-error-parser.js';

test('解析 LNK2019：符号、引用函数和 OBJ 文件', () => {
  const log = 'main.obj : error LNK2019: unresolved external symbol "acrxGetApiVersion" referenced in function "cmdARXHello"';

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 1);

  const error = result.errors[0];

  assert.equal(error.code, 'LNK2019');
  assert.equal(error.symbol, 'acrxGetApiVersion');
  assert.equal(error.referencedBy, 'cmdARXHello');
  assert.equal(error.sourceFile, 'main.obj');
  assert.equal(error.severity, 'error');
});

test('解析 LNK2001：无法解析的外部符号', () => {
  const log = 'error LNK2001: unresolved external symbol "AcEdCommandStack::desc"';

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'LNK2001');
  assert.equal(result.errors[0].symbol, 'AcEdCommandStack::desc');
  assert.equal(result.errors[0].sourceFile, null);
});

test('解析 LNK1104：保留带空格的库文件路径', () => {
  const log = 'LINK : fatal error LNK1104: cannot open file "C:\\Program Files\\ObjectARX SDK\\acedapi.lib"';

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'LNK1104');
  assert.equal(
    result.errors[0].inputFile,
    'C:\\Program Files\\ObjectARX SDK\\acedapi.lib'
  );
  assert.equal(result.summary.missingInputFiles, 1);
});

test('解析 LNK1120：提取未解析符号数量', () => {
  const log = 'LINK : fatal error LNK1120: 4 unresolved externals';

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'LNK1120');
  assert.equal(result.errors[0].unresolvedCount, 4);
  assert.equal(result.summary.unresolvedExternalCount, 4);
  assert.equal(result.summary.unresolvedSymbolErrors, 0);
});

test('混合日志：分别统计四种错误', () => {
  const log = [
    'main.obj : error LNK2019: unresolved external symbol "symbolA" referenced in function "funcA"',
    'other.obj : error LNK2001: unresolved external symbol "symbolB"',
    'LINK : fatal error LNK1104: cannot open file "acedapi.lib"',
    'LINK : fatal error LNK1120: 2 unresolved externals'
  ].join('\r\n');

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 4);
  assert.equal(result.summary.byCode.LNK2019, 1);
  assert.equal(result.summary.byCode.LNK2001, 1);
  assert.equal(result.summary.byCode.LNK1104, 1);
  assert.equal(result.summary.byCode.LNK1120, 1);
  assert.equal(result.summary.unresolvedSymbolErrors, 2);
  assert.equal(result.summary.missingInputFiles, 1);
  assert.equal(result.summary.unresolvedExternalCount, 2);
});

test('保留原始日志，忽略无关警告和普通文本', () => {
  const log = [
    'warning LNK4099: PDB not found',
    '这是普通文本，提到了 LNK2019 但不是错误行',
    'main.obj : error LNK2019: unresolved external symbol "testSymbol"'
  ].join('\n');

  const result = parseLinkErrors(log);

  assert.equal(result.rawLog, log);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].symbol, 'testSymbol');
});

test('空日志返回空错误列表和零计数', () => {
  const result = parseLinkErrors('');

  assert.equal(result.success, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.unresolvedSymbolErrors, 0);
});

test('支持 null 和非字符串输入', () => {
  const result = parseLinkErrors(null);

  assert.equal(result.success, true);
  assert.equal(result.rawLog, '');
  assert.equal(result.errors.length, 0);
});

test('边界：无来源文件前缀的 LNK2001', () => {
  const result = parseLinkErrors(
    'error LNK2001: unresolved external symbol "missingSymbol"'
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].sourceFile, null);
  assert.equal(result.errors[0].symbol, 'missingSymbol');
});

test('边界：普通文本提到 LNK2019 不得误判', () => {
  const log = [
    '说明：LNK2019 是链接错误代码',
    'warning LNK4099: PDB not found',
    '这是普通文本 LNK2019: 但不是链接器错误'
  ].join('\n');

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 0);
});

test('边界：带空格的 Windows OBJ 路径', () => {
  const result = parseLinkErrors(
    'C:\\Build Files\\main.obj : error LNK2019: unresolved external symbol "testSymbol"'
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].sourceFile, 'C:\\Build Files\\main.obj');
});

test('边界：LNK1104 未加引号的文件名', () => {
  const result = parseLinkErrors(
    'LINK : fatal error LNK1104: cannot open file acedapi.lib'
  );

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].inputFile, 'acedapi.lib');
});

test('边界：CRLF 多行日志统计', () => {
  const log = [
    'main.obj : error LNK2001: unresolved external symbol "symbolA"',
    'LINK : fatal error LNK1120: 1 unresolved externals'
  ].join('\r\n');

  const result = parseLinkErrors(log);

  assert.equal(result.errors.length, 2);
  assert.equal(result.summary.byCode.LNK2001, 1);
  assert.equal(result.summary.byCode.LNK1120, 1);
  assert.equal(result.summary.unresolvedExternalCount, 1);
});
