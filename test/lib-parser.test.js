import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLibMemberList,
  parseLinkerMemberOutput,
  analyzeLibText
} from '../src/core/lib-parser.js';

test('解析 rxapi 风格的 OBJ 成员清单', () => {
  const input = `
Microsoft (R) Library Manager Version 14.51.36260.0
Copyright (C) Microsoft Corporation. All rights reserved.

rxapi.dir\\Release\\rxinit.obj
rxapi.dir\\Release\\libinit.obj
rxapi.dir\\Release\\nullSubent.obj
`;

  const result = parseLibMemberList(input);

  assert.equal(result.memberCount, 3);
  assert.equal(result.objMemberCount, 3);
  assert.equal(result.otherMemberCount, 0);
  assert.equal(result.members[2].name, 'rxapi.dir\\Release\\nullSubent.obj');
});

test('重复 DLL 成员不能被合并', () => {
  const input = `
Microsoft (R) Library Manager Version 14.51.36260.0

accore.dll
accore.dll
accore.dll
`;

  const result = parseLibMemberList(input);

  assert.equal(result.memberCount, 3);
  assert.equal(result.objMemberCount, 0);
  assert.equal(result.otherMemberCount, 3);
});

test('只解析 public symbols 区域，不解析 offsets', () => {
  const input = `
Dump of file sample.lib

File Type: LIBRARY

    3 offsets

        1   1C14C2
        2   1C16E8
        3   1C181E

    2 public symbols

        1 ?first@@YAXXZ
        3 ?second@@YAXXZ
`;

  const result = parseLinkerMemberOutput(input);

  assert.equal(result.symbolCount, 2);
  assert.equal(result.symbols[0].memberIndex, 1);
  assert.equal(result.symbols[0].symbol, '?first@@YAXXZ');
  assert.equal(result.symbols[1].memberIndex, 3);
});

test('关联成员编号和符号索引', () => {
  const memberList = `
one.obj
two.obj
three.obj
`;

  const symbolIndex = `
    2 public symbols

        1 ?first@@YAXXZ
        3 ?third@@YAXXZ
`;

  const result = analyzeLibText(memberList, symbolIndex);

  assert.equal(result.memberCount, 3);
  assert.equal(result.objMemberCount, 3);
  assert.equal(result.symbolCount, 2);
  assert.deepEqual(result.members[0].symbols, ['?first@@YAXXZ']);
  assert.deepEqual(result.members[1].symbols, []);
  assert.deepEqual(result.members[2].symbols, ['?third@@YAXXZ']);
  assert.equal(
    result.evidenceLevel,
    'LIB_MEMBER_LIST_AND_PUBLIC_SYMBOL_INDEX'
  );
});

test('发现超出成员清单范围的符号编号', () => {
  const result = analyzeLibText(
    'one.obj',
    '1 public symbols\n\n    3 ?missing@@YAXXZ'
  );

  assert.deepEqual(result.outOfRangeMemberNumbers, [3]);
});