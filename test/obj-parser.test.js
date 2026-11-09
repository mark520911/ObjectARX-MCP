import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseObjSymbols,
  analyzeObjText
} from '../src/core/obj-parser.js';

test('解析 member_7 风格的定义和未定义引用', () => {
  const input = `
COFF SYMBOL TABLE
00A 00000000 UNDEF  notype       External     | acrxGetApiVersionImpl
00B 00000000 SECT1  notype ()    External     | acrxGetApiVersion
00C 00000000 SECT1  notype       Static       | $$000000
`;

  const result = parseObjSymbols(input);

  assert.equal(result.symbolCount, 3);
  assert.equal(result.undefinedCount, 1);
  assert.equal(result.definedCount, 2);

  assert.equal(result.undefined[0].name, 'acrxGetApiVersionImpl');
  assert.equal(result.defined[0].name, 'acrxGetApiVersion');
  assert.equal(result.defined[0].storageClass, 'External');
  assert.equal(result.defined[1].storageClass, 'Static');
});

test('识别十六进制节编号 SECTA、SECTB、SECTC', () => {
  const input = `
01F 00000000 SECTA  notype       External     | ?symbolA@@3HA
022 00000000 SECTB  notype       External     | ?symbolB@@3HA
025 00000000 SECTC  notype       External     | ?symbolC@@3HA
`;

  const result = parseObjSymbols(input);

  assert.equal(result.definedCount, 3);
  assert.equal(result.defined[0].section, 'SECTA');
  assert.equal(result.defined[1].section, 'SECTB');
  assert.equal(result.defined[2].section, 'SECTC');
});

test('识别 ABS 绝对符号', () => {
  const input = `
000 01037A64 ABS    notype       Static       | @comp.id
001 00000010 ABS    notype       Static       | @feat.00
`;

  const result = parseObjSymbols(input);

  assert.equal(result.absoluteCount, 2);
  assert.equal(result.absolute[0].name, '@comp.id');
  assert.equal(result.absolute[0].valueHex, '01037A64');
});

test('识别 WeakExternal 和 Default symbol', () => {
  const input = `
00A 00000000 UNDEF  notype       WeakExternal | weak_symbol
    Default symbol: fallback_symbol
00B 00000000 UNDEF  notype       External     | normal_symbol
`;

  const result = parseObjSymbols(input);

  assert.equal(result.weakExternalCount, 1);
  assert.equal(result.undefinedCount, 1);
  assert.equal(result.weakExternals[0].name, 'weak_symbol');
  assert.equal(result.weakExternals[0].defaultSymbol, 'fallback_symbol');
  assert.equal(result.undefined[0].name, 'normal_symbol');
});

test('保留 C++ 修饰符号名称，不擅自解码', () => {
  const input = `
012 00000000 UNDEF notype () External | ??0AcDbFullSubentPath@@QEAA@VAcDbObjectId@@VAcDbSubentId@@@Z
`;

  const result = parseObjSymbols(input);

  assert.equal(result.undefinedCount, 1);
  assert.equal(
    result.undefined[0].name,
    '??0AcDbFullSubentPath@@QEAA@VAcDbObjectId@@VAcDbSubentId@@@Z'
  );
  assert.equal(result.undefined[0].type, 'notype ()');
});

test('生成 MCP 使用的 OBJ 分析结果', () => {
  const result = analyzeObjText(`
00A 00000000 UNDEF notype External | external_symbol
00B 00000000 SECT1 notype External | defined_symbol
`);

  assert.equal(result.format, 'COFF OBJECT');
  assert.equal(result.definedCount, 1);
  assert.equal(result.undefinedCount, 1);
  assert.equal(result.evidenceLevel, 'OBJ_SYMBOL_TABLE_ANALYSIS');
  assert.ok(Array.isArray(result.limitations));
});