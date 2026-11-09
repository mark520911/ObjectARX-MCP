const EVIDENCE_LEVEL = {
  VERIFIED: 'OBJ_REFERENCE_LIB_INDEX_AND_MEMBER_OBJ_DEFINITION',
  INDEX_ONLY: 'OBJ_REFERENCE_AND_LIB_INDEX_ONLY',
  NOT_FOUND: 'OBJ_REFERENCE_WITHOUT_LIB_INDEX_MATCH',
  INCOMPLETE: 'INCOMPLETE_ANALYSIS'
};

function isExternalDefinition(symbol) {
  return symbol.category === 'defined' &&
    symbol.storageClass === 'External';
}

/**
 * Trace undefined symbols from one OBJ against library indexes
 * and, when available, the corresponding member OBJ analyses.
 *
 * libraries:
 * [{
 *   name: 'rxapi.lib',
 *   analysis: analyzeLibText(...) result,
 *   memberObjAnalyses: {
 *     4: {
 *       memberName: 'libinit.obj',
 *       analysis: analyzeObjText(...) result
 *     }
 *   }
 * }]
 */
export function traceSymbolReferences({
  sourceObjName,
  sourceObjAnalysis,
  libraries = []
} = {}) {
  if (!sourceObjAnalysis ||
      !Array.isArray(sourceObjAnalysis.undefined)) {
    throw new TypeError(
      'sourceObjAnalysis 必须是 analyzeObjText() 的分析结果'
    );
  }

  if (!Array.isArray(libraries)) {
    throw new TypeError('libraries 必须是数组');
  }

  const traces = [];
  let invalidLibraryCount = 0;

  for (const reference of sourceObjAnalysis.undefined) {
    const symbolName = reference.name;
    const candidates = [];
    const problems = [];

    for (const library of libraries) {
      const analysis = library?.analysis;

      if (!analysis ||
          !Array.isArray(analysis.symbols) ||
          !Array.isArray(analysis.members)) {
        invalidLibraryCount++;

        problems.push({
          library: library?.name ?? null,
          reason: 'INVALID_LIBRARY_ANALYSIS'
        });
        continue;
      }

      const matches = analysis.symbols.filter(
        item => item.symbol === symbolName
      );

      for (const match of matches) {
        const memberIndex = match.memberIndex;
        const member = analysis.members[memberIndex - 1];

        if (!member) {
          candidates.push({
            library: library.name ?? null,
            memberIndex,
            memberName: null,
            status: 'MEMBER_INDEX_OUT_OF_RANGE',
            definitionVerified: false
          });
          continue;
        }

        if (!member.isObj) {
          candidates.push({
            library: library.name ?? null,
            memberIndex,
            memberName: member.name,
            status: 'INDEXED_MEMBER_NOT_OBJ',
            definitionVerified: false
          });
          continue;
        }

        const memberData =
          library.memberObjAnalyses?.[String(memberIndex)] ??
          library.memberObjAnalyses?.[memberIndex];

        if (!memberData?.analysis ||
            !Array.isArray(memberData.analysis.defined)) {
          candidates.push({
            library: library.name ?? null,
            memberIndex,
            memberName: member.name,
            status: 'MEMBER_OBJ_MISSING',
            definitionVerified: false
          });
          continue;
        }

        const definitions = memberData.analysis.defined.filter(
          item => item.name === symbolName
        );

        const externalDefinitions = definitions.filter(
          isExternalDefinition
        );

        candidates.push({
          library: library.name ?? null,
          memberIndex,
          memberName: member.name,
          objName: memberData.memberName ?? member.name,
          status: externalDefinitions.length > 0
            ? 'DEFINITION_VERIFIED'
            : 'INDEX_MATCH_ONLY',
          definitionVerified: externalDefinitions.length > 0,
          definitionCount: externalDefinitions.length,
          nonExternalDefinitionCount:
            definitions.length - externalDefinitions.length
        });
      }
    }

    const verified = candidates.filter(
      item => item.definitionVerified
    );

    let status;

    if (verified.length > 1) {
      status = 'MULTIPLE_VERIFIED_DEFINITIONS';
    } else if (verified.length === 1) {
      status = 'DEFINITION_VERIFIED';
    } else if (candidates.some(
      item => item.status === 'MEMBER_OBJ_MISSING'
    )) {
      status = 'MEMBER_OBJ_MISSING';
    } else if (candidates.some(
      item => item.status === 'MEMBER_INDEX_OUT_OF_RANGE'
    )) {
      status = 'MEMBER_INDEX_OUT_OF_RANGE';
    } else if (candidates.some(
      item => item.status === 'INDEXED_MEMBER_NOT_OBJ'
    )) {
      status = 'INDEXED_MEMBER_NOT_OBJ';
    } else if (candidates.length > 0) {
      status = 'INDEX_MATCH_ONLY';
    } else {
      status = 'NOT_FOUND';
    }

    traces.push({
      symbol: symbolName,
      sourceObj: sourceObjName ?? null,
      referenceCategory: reference.category,
      status,
      definitionVerified: verified.length > 0,
      candidateCount: candidates.length,
      verifiedDefinitionCount: verified.length,
      candidates,
      problems
    });
  }

  const verifiedCount = traces.filter(
    item => item.definitionVerified
  ).length;

  const hasIndexMatch = traces.some(
    trace => trace.candidateCount > 0
  );

  const hasInvalidAnalysis = invalidLibraryCount > 0;

  let evidenceLevel;

  if (hasInvalidAnalysis) {
    evidenceLevel = EVIDENCE_LEVEL.INCOMPLETE;
  } else if (verifiedCount > 0) {
    evidenceLevel = EVIDENCE_LEVEL.VERIFIED;
  } else if (hasIndexMatch) {
    evidenceLevel = EVIDENCE_LEVEL.INDEX_ONLY;
  } else {
    evidenceLevel = EVIDENCE_LEVEL.NOT_FOUND;
  }

  const limitations = [
    'LIB 符号索引匹配不等于成员 OBJ 已定义目标符号。',
    '只有成员 OBJ 中 storageClass 为 External 的同名定义才计为已验证。',
    '重复定义仅表示当前提供的 LIB 样本中存在多个定义证据。',
    '未执行最终链接，不能据此认定工程链接成功。',
    '当前版本追踪普通 UNDEF 引用，弱外部符号暂不参与追踪。'
  ];

  if (hasInvalidAnalysis) {
    limitations.push(
      `存在 ${invalidLibraryCount} 次无效 LIB 分析，结果可能不完整。`
    );
  }

  return {
    sourceObjName: sourceObjName ?? null,
    referenceCount: traces.length,
    verifiedCount,
    unresolvedCount: traces.length - verifiedCount,
    invalidLibraryCount,
    traces,
    evidenceLevel,
    limitations
  };
}