import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeProjectLink } from '../src/tools/project-link-diagnostics.js';

function makeDependencies(overrides = {}) {
  return {
    inspectMsbuildProjectFn: async () => ({
      success: true,
      evidence: ['PROJECT_INSPECTION_OK'],
      diagnostics: []
    }),
    parseLinkLogFn: input => ({
      success: true,
      buildStatus: 'FAILED',
      linkStatus: 'FAILED',
      errors: [],
      errorSummary: {},
      evidence: ['LINK_LOG_PARSED'],
      limitations: [],
      received: input
    }),
    traceSymbolInLibrariesFn: async () => ({
      success: true,
      trace: {
        traces: [],
        evidenceLevel: 'OBJ_REFERENCE_WITHOUT_LIB_INDEX_MATCH',
        limitations: []
      },
      limitations: ['STATIC_SYMBOL_ANALYSIS_ONLY']
    }),
    ...overrides
  };
}

test('no build log does not trigger empty log parsing', async () => {
  let parseCalls = 0;

  const dependencies = makeDependencies({
    parseLinkLogFn: () => {
      parseCalls++;
      throw new Error('Parser should not be called');
    }
  });

  const result = await analyzeProjectLink(
    { projectFile: 'test.vcxproj' },
    dependencies
  );

  assert.equal(result.success, true);
  assert.equal(result.projectInspection.success, true);
  assert.equal(result.buildAnalysis, null);
  assert.equal(parseCalls, 0);
});

test('provided linker log is parsed and classified', async () => {
  const dependencies = makeDependencies({
    parseLinkLogFn: () => ({
      success: true,
      buildStatus: 'FAILED',
      linkStatus: 'FAILED',
      errors: [
        {
          code: 'LNK2019',
          symbol: 'acrxGetApiVersion',
          referencedBy: 'libinit.obj'
        },
        {
          code: 'LNK1104',
          inputFile: 'acedapi.lib'
        },
        {
          code: 'LNK1120',
          unresolvedCount: 1
        }
      ],
      errorSummary: {},
      evidence: [],
      limitations: []
    })
  });

  const result = await analyzeProjectLink(
    {
      projectFile: 'test.vcxproj',
      stdout: 'Build FAILED',
      exitCode: 1
    },
    dependencies
  );

  assert.equal(result.overallStatus, 'FAILED');
  assert.equal(result.rootCauseCandidates.length, 3);

  assert.equal(
    result.rootCauseCandidates[0].evidenceLevel,
    'LOG_CONFIRMED'
  );

  assert.equal(
    result.rootCauseCandidates[1].type,
    'MISSING_INPUT_FILE'
  );

  assert.equal(
    result.rootCauseCandidates[2].unresolvedCount,
    1
  );
});

test('symbol NOT_FOUND is limited to supplied library indexes', async () => {
  const dependencies = makeDependencies({
    traceSymbolInLibrariesFn: async () => ({
      success: true,
      trace: {
        traces: [
          {
            symbol: 'acrxGetApiVersion',
            status: 'NOT_FOUND'
          }
        ],
        evidenceLevel: 'OBJ_REFERENCE_WITHOUT_LIB_INDEX_MATCH',
        limitations: []
      },
      limitations: []
    })
  });

  const result = await analyzeProjectLink(
    {
      projectFile: 'test.vcxproj',
      sourceObjPath: 'source.obj',
      libraryPaths: ['test.lib']
    },
    dependencies
  );

  assert.equal(result.rootCauseCandidates.length, 1);
  assert.equal(
    result.rootCauseCandidates[0].evidenceLevel,
    'LIB_INDEX_NOT_FOUND'
  );

  assert.equal(
    result.rootCauseCandidates[0].type,
    'SYMBOL_NOT_FOUND_IN_PROVIDED_LIBRARIES'
  );
});

test('symbol trace failure does not discard project inspection', async () => {
  const dependencies = makeDependencies({
    traceSymbolInLibrariesFn: async () => ({
      success: false,
      stage: 'INSPECT_SOURCE_OBJ',
      error: 'OBJ inspection failed'
    })
  });

  const result = await analyzeProjectLink(
    {
      projectFile: 'test.vcxproj',
      sourceObjPath: 'source.obj',
      libraryPaths: ['test.lib']
    },
    dependencies
  );

  assert.equal(result.projectInspection.success, true);
  assert.equal(result.symbolTrace.success, false);
  assert.equal(result.overallStatus, 'PARTIAL');
});

test('invalid library paths are rejected before diagnostics', async () => {
  let inspectCalls = 0;

  const dependencies = makeDependencies({
    inspectMsbuildProjectFn: async () => {
      inspectCalls++;
      return { success: true };
    }
  });

  const result = await analyzeProjectLink(
    {
      projectFile: 'test.vcxproj',
      sourceObjPath: 'source.obj',
      libraryPaths: []
    },
    dependencies
  );

  assert.equal(result.success, false);
  assert.equal(inspectCalls, 0);
});

test('LIB member index out of range is classified as an evidence lead', async () => {
  const dependencies = makeDependencies({
    traceSymbolInLibrariesFn: async () => ({
      success: true,
      trace: {
        traces: [{ symbol: 'targetSymbol', status: 'MEMBER_INDEX_OUT_OF_RANGE' }],
        evidenceLevel: 'INCOMPLETE_ANALYSIS',
        limitations: []
      },
      limitations: []
    })
  });

  const result = await analyzeProjectLink({
    projectFile: 'test.vcxproj',
    sourceObjPath: 'source.obj',
    libraryPaths: ['test.lib']
  }, dependencies);

  assert.equal(result.success, true);
  assert.equal(result.overallStatus, 'PARTIAL');
  assert.equal(result.rootCauseCandidates[0].type, 'LIB_MEMBER_INDEX_OUT_OF_RANGE');
  assert.equal(result.rootCauseCandidates[0].evidenceLevel, 'LIB_INDEX_INCONSISTENCY');
});

test('indexed non-OBJ member is classified without claiming a verified root cause', async () => {
  const dependencies = makeDependencies({
    traceSymbolInLibrariesFn: async () => ({
      success: true,
      trace: {
        traces: [{ symbol: 'targetSymbol', status: 'INDEXED_MEMBER_NOT_OBJ' }],
        evidenceLevel: 'INCOMPLETE_ANALYSIS',
        limitations: []
      },
      limitations: []
    })
  });

  const result = await analyzeProjectLink({
    projectFile: 'test.vcxproj',
    sourceObjPath: 'source.obj',
    libraryPaths: ['test.lib']
  }, dependencies);

  assert.equal(result.success, true);
  assert.equal(result.rootCauseCandidates[0].type, 'LIB_INDEXED_MEMBER_NOT_OBJ');
  assert.equal(result.rootCauseCandidates[0].evidenceLevel, 'LIB_MEMBER_TYPE_MISMATCH');
});

test('diagnostic success is false when symbol tracing fails', async () => {
  const dependencies = makeDependencies({
    traceSymbolInLibrariesFn: async () => ({
      success: false,
      stage: 'INSPECT_SOURCE_OBJ',
      error: 'OBJ inspection failed'
    })
  });

  const result = await analyzeProjectLink({
    projectFile: 'test.vcxproj',
    sourceObjPath: 'source.obj',
    libraryPaths: ['test.lib']
  }, dependencies);

  assert.equal(result.success, false);
  assert.equal(result.overallStatus, 'PARTIAL');
});

test('diagnostic success can be true without a build log', async () => {
  const result = await analyzeProjectLink(
    { projectFile: 'test.vcxproj' },
    makeDependencies()
  );

  assert.equal(result.success, true);
  assert.equal(result.buildAnalysis, null);
  assert.equal(result.overallStatus, 'PARTIAL');
});
