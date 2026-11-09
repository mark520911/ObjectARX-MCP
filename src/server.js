import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchDocs, lookupApi, findHeader, searchExamples, getSection, diagnose } from './search/query.js';
import { db, initSchema } from './db.js';
import { config } from '../config/config.js';
import { inspectProject } from './tools/inspect-project.js';
import { inspectEnvironment } from './tools/environment.js';
import { inspectLibFile, inspectObjFile } from './tools/binary-analysis.js';
import { traceSymbolInLibraries } from './tools/symbol-trace-runner.js';
import { parseLinkLog } from './core/link-log-parser.js';
import { analyzeProjectLink } from './tools/project-link-diagnostics.js';

// Ensure a first-time launch or an older database always has the required schema.
initSchema();

const server = new McpServer({ name: 'objectarx-2024-local-docs', version: '1.1.0' });
const out = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

server.tool('arx_search', 'Search local official ObjectARX documentation. Returns short ranked excerpts with section IDs and source paths.',
  { query: z.string().min(1), topK: z.number().int().min(1).max(10).optional() },
  async ({ query, topK }) => out(searchDocs(query, topK || 5)));
server.tool('arx_api_lookup', 'Exact lookup for ObjectARX C++ classes, functions, structs and enums extracted from SDK headers.',
  { symbol: z.string().min(1) }, async ({ symbol }) => out(lookupApi(symbol)));
server.tool('arx_get_section', 'Read one full documentation section using sectionId returned by arx_search.',
  { sectionId: z.number().int().positive() }, async ({ sectionId }) => {
    const r = getSection(sectionId); return out(r || { error: 'Section not found', sectionId });
  });
server.tool('arx_find_header', 'Find SDK header files associated with a class or API symbol.',
  { symbol: z.string().min(1) }, async ({ symbol }) => out(findHeader(symbol)));
server.tool('arx_search_example', 'Search C++ code examples extracted from CHM documentation.',
  { query: z.string().min(1), limit: z.number().int().min(1).max(5).optional() },
  async ({ query, limit }) => out(searchExamples(query, limit || 3)));
server.tool('arx_diagnose', 'Evidence-based first-pass diagnosis for ObjectARX compiler and linker errors. Does not modify project files.',
  { error: z.string().min(1), symbol: z.string().optional(), configuration: z.string().optional(), platform: z.string().optional() },
  async args => out(diagnose({ error: args.error, symbol: args.symbol || '', configuration: args.configuration || 'Release', platform: args.platform || 'x64' })));
server.tool('arx_inspect_project', 'Read-only inspection of a Visual Studio .vcxproj/.props file for ObjectARX include/library paths, LIB dependencies, DEF file and toolset settings. Never modifies files.',
  { projectFile: z.string().min(1) }, async ({ projectFile }) => out(inspectProject(projectFile)));
server.tool('arx_kb_status', 'Show local knowledge base counts and configured SDK paths.', {}, async () => {
  const count = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  return out({ database: config.databasePath, docsDir: config.docsDir, includeDir: config.includeDir,
    documents: count('documents'), sections: count('sections'), symbols: count('symbols'), examples: count('examples') });
});

server.tool(
  'arx_environment',
  'Inspect the local ObjectARX SDK and Visual Studio build environment. Read-only; does not modify files.',
  {},
  async () => out(inspectEnvironment())
);


// MCP 2.2.5: LIB / OBJ binary inspection and symbol tracing.
server.tool(
  'arx_inspect_lib',
  'Inspect an ObjectARX LIB file using lib.exe and dumpbin.exe. Read-only analysis.',
  { libraryPath: z.string().min(1) },
  async ({ libraryPath }) => out(await inspectLibFile(libraryPath))
);

server.tool(
  'arx_inspect_obj',
  'Inspect an ObjectARX OBJ file and report defined and undefined symbols using dumpbin.exe.',
  { objectPath: z.string().min(1) },
  async ({ objectPath }) => out(await inspectObjFile(objectPath))
);

server.tool(
  'arx_analyze_link_log',
  'Analyze a supplied MSBuild log and report build/link status, linker errors and evidence. Does not execute MSBuild or modify project files.',
  {
    stdout: z.string(),
    stderr: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    timedOut: z.boolean().optional(),
    truncated: z.boolean().optional()
  },
  async args => out(parseLinkLog({
    stdout: args.stdout,
    stderr: args.stderr || '',
    exitCode: args.exitCode ?? null,
    timedOut: args.timedOut ?? false,
    truncated: args.truncated ?? false
  }))
);

server.tool(
  'arx_trace_symbol',
  'Trace undefined symbols from a source OBJ into LIB member indexes and verify extracted member OBJ definitions. Static analysis only; does not prove final linking success.',
  {
    objectPath: z.string().min(1),
    libraryPaths: z.array(z.string().min(1)).min(1).max(10)
  },
  async ({ objectPath, libraryPaths }) =>
    out(await traceSymbolInLibraries(objectPath, libraryPaths))
);

server.tool(
  'arx_analyze_project_link',
  'Analyze an ObjectARX Visual Studio project, optional linker log, and optional OBJ/LIB symbol references. Read-only diagnostics; does not execute Build, Rebuild or Clean.',
  {
    projectFile: z.string().min(1),
    configuration: z.enum(['Debug', 'Release']).optional(),
    platform: z.string().min(1).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    timedOut: z.boolean().optional(),
    truncated: z.boolean().optional(),
    sourceObjPath: z.string().min(1).optional(),
    libraryPaths: z.array(z.string().min(1)).min(1).max(10).optional()
  },
  async args => out(await analyzeProjectLink(args))
);
const transport = new StdioServerTransport();
await server.connect(transport);
