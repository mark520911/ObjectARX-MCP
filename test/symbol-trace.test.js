import test from 'node:test';
import assert from 'node:assert/strict';

import { traceSymbolReferences } from '../src/core/symbol-trace.js';

function makeSourceObj(name) {
  return {
    undefined: [
      {
        name,
        category: 'undefined',
        storageClass: 'External'
      }
    ]
  };
}

function makeLibrary({
  symbol,
  memberIndex = 1,
  memberName = 'provider.obj',
  memberObjAnalysis,
  isObj = true
}) {
  const members = [];

  members[memberIndex - 1] = {
    index: memberIndex,
    name: memberName,
    isObj
  };

  return {
    name: 'test.lib',
    analysis: {
      memberCount: members.length,
      members,
      symbols: [
        {
          memberIndex,
          symbol
        }
      ]
    },
    memberObjAnalyses: memberObjAnalysis
      ? {
          [String(memberIndex)]: {
            memberName,
            analysis: memberObjAnalysis
          }
        }
      : {}
  };
}

test('真实 ObjectARX 符号关系：引用到成员 OBJ 定义', () => {
  const result = traceSymbolReferences({
    sourceObjName: 'libinitx64.obj',
    sourceObjAnalysis: makeSourceObj('acrxGetApiVersionImpl'),
    libraries: [
      makeLibrary({
        symbol: 'acrxGetApiVersionImpl',
        memberIndex: 4,
        memberName: 'libinit.obj',
        memberObjAnalysis: {
          defined: [
            {
              name: 'acrxGetApiVersionImpl',
              category: 'defined',
              storageClass: 'External'
            }
          ]
        }
      })
    ]
  });

  assert.equal(result.referenceCount, 1);
  assert.equal(result.verifiedCount, 1);
  assert.equal(result.unresolvedCount, 0);

  assert.equal(
    result.traces[0].status,
    'DEFINITION_VERIFIED'
  );

  assert.equal(
    result.traces[0].candidates[0].memberIndex,
    4
  );

  assert.equal(
    result.traces[0].candidates[0].memberName,
    'libinit.obj'
  );

  assert.equal(
    result.traces[0].definitionVerified,
    true
  );
});

test('只有 LIB 索引，没有成员 OBJ 分析结果', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('targetSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'targetSymbol'
      })
    ]
  });

  assert.equal(
    result.traces[0].status,
    'MEMBER_OBJ_MISSING'
  );

  assert.equal(result.verifiedCount, 0);
});

test('LIB 中找不到引用符号', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('missingSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'anotherSymbol'
      })
    ]
  });

  assert.equal(
    result.traces[0].status,
    'NOT_FOUND'
  );
});

test('LIB 成员编号超出成员列表范围', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('targetSymbol'),
    libraries: [
      {
        name: 'broken.lib',
        analysis: {
          memberCount: 1,
          members: [
            {
              index: 1,
              name: 'one.obj',
              isObj: true
            }
          ],
          symbols: [
            {
              memberIndex: 2,
              symbol: 'targetSymbol'
            }
          ]
        },
        memberObjAnalyses: {}
      }
    ]
  });

  assert.equal(
    result.traces[0].status,
    'MEMBER_INDEX_OUT_OF_RANGE'
  );
});

test('识别多个成员 OBJ 中的重复定义', () => {
  const libraries = [1, 2].map(index =>
    makeLibrary({
      symbol: 'duplicateSymbol',
      memberIndex: index,
      memberName: `provider${index}.obj`,
      memberObjAnalysis: {
        defined: [
          {
            name: 'duplicateSymbol',
            category: 'defined',
            storageClass: 'External'
          }
        ]
      }
    })
  );

  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('duplicateSymbol'),
    libraries
  });

  assert.equal(
    result.traces[0].status,
    'MULTIPLE_VERIFIED_DEFINITIONS'
  );

  assert.equal(
    result.traces[0].verifiedDefinitionCount,
    2
  );
});

test('不把 Static 内部符号误认为外部定义', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('internalSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'internalSymbol',
        memberObjAnalysis: {
          defined: [
            {
              name: 'internalSymbol',
              category: 'defined',
              storageClass: 'Static'
            }
          ]
        }
      })
    ]
  });

  assert.equal(
    result.traces[0].status,
    'INDEX_MATCH_ONLY'
  );

  assert.equal(
    result.traces[0].definitionVerified,
    false
  );
});
// MCP_224_EVIDENCE_LEVEL_TESTS

test('已验证定义时返回最高证据等级', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('verifiedSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'verifiedSymbol',
        memberObjAnalysis: {
          defined: [
            {
              name: 'verifiedSymbol',
              category: 'defined',
              storageClass: 'External'
            }
          ]
        }
      })
    ]
  });

  assert.equal(
    result.evidenceLevel,
    'OBJ_REFERENCE_LIB_INDEX_AND_MEMBER_OBJ_DEFINITION'
  );
});

test('只有 LIB 索引命中时返回 INDEX_ONLY 证据等级', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('indexedSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'indexedSymbol'
      })
    ]
  });

  assert.equal(
    result.traces[0].status,
    'MEMBER_OBJ_MISSING'
  );

  assert.equal(
    result.evidenceLevel,
    'OBJ_REFERENCE_AND_LIB_INDEX_ONLY'
  );
});

test('有效 LIB 均未命中时返回 NOT_FOUND 证据等级', () => {
  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('missingSymbol'),
    libraries: [
      makeLibrary({
        symbol: 'anotherSymbol'
      })
    ]
  });

  assert.equal(
    result.traces[0].status,
    'NOT_FOUND'
  );

  assert.equal(
    result.evidenceLevel,
    'OBJ_REFERENCE_WITHOUT_LIB_INDEX_MATCH'
  );
});

test('存在无效 LIB 分析时标记 INCOMPLETE_ANALYSIS', () => {
  const verifiedLibrary = makeLibrary({
    symbol: 'verifiedSymbol',
    memberObjAnalysis: {
      defined: [
        {
          name: 'verifiedSymbol',
          category: 'defined',
          storageClass: 'External'
        }
      ]
    }
  });

  const invalidLibrary = {
    name: 'invalid.lib',
    analysis: {
      symbols: []
    },
    memberObjAnalyses: {}
  };

  const result = traceSymbolReferences({
    sourceObjAnalysis: makeSourceObj('verifiedSymbol'),
    libraries: [
      verifiedLibrary,
      invalidLibrary
    ]
  });

  assert.equal(result.verifiedCount, 1);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.invalidLibraryCount, 1);

  assert.equal(
    result.traces[0].status,
    'DEFINITION_VERIFIED'
  );

  assert.equal(
    result.evidenceLevel,
    'INCOMPLETE_ANALYSIS'
  );

  assert.equal(
    result.traces[0].problems[0].reason,
    'INVALID_LIBRARY_ANALYSIS'
  );
});