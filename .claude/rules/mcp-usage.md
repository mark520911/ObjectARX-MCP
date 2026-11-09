# ObjectARX-MCP Tool Usage Rules

## 1. General Principles

- MCP Server name: `objectarx-docs`.
- Use MCP tools only when the task requires ObjectARX-specific SDK knowledge, project inspection, environment inspection, or diagnostics.
- Select tools according to the actual task.
- Prefer exact queries and minimal tool calls.
- Never claim a tool was called successfully unless its result is available.
- If the MCP server or a required tool is unavailable, state this clearly.

## 2. Tool Selection

### API and SDK Documentation

| User task | Tool |
|---|---|
| Verify an API symbol | `arx_api_lookup` |
| Locate an SDK header | `arx_find_header` |
| Search official documentation | `arx_search` |
| Find implementation examples | `arx_search_example` |
| Retrieve a complete documentation section | `arx_get_section` |

Follow `api-workflow.md` for API verification.

### Project and Environment Inspection

| User task | Tool |
|---|---|
| Inspect a Visual Studio project or property sheet | `arx_inspect_project` |
| Inspect SDK and Visual Studio environment | `arx_environment` |
| Analyze project configuration and linker dependencies | `arx_analyze_project_link` |
| Check indexed knowledge base status | `arx_kb_status` |

Do not assume the configured IDE or Platform Toolset. Inspect the actual project when relevant.

### Compiler and Linker Diagnostics

| User task | Tool |
|---|---|
| Analyze compiler or linker errors | `arx_diagnose` |
| Analyze an MSBuild log | `arx_analyze_link_log` |
| Inspect an OBJ file | `arx_inspect_obj` |
| Inspect a LIB file | `arx_inspect_lib` |
| Trace a symbol through OBJ and LIB files | `arx_trace_symbol` |

Only use file-inspection tools when the actual files and paths are available.

`arx_trace_symbol` requires an existing object file path and valid library paths. Never fabricate these paths.

## 3. Recommended Workflows

### API Development

1. `arx_api_lookup`
2. `arx_find_header`
3. `arx_search` when documentation context is needed.
4. `arx_search_example` when an implementation example is useful.
5. `arx_get_section` only when a complete section is necessary.

### Project Configuration

1. `arx_inspect_project`
2. `arx_environment` when SDK or compiler environment matters.
3. `arx_analyze_project_link` when linker configuration needs deeper analysis.

### Linker Errors

1. `arx_diagnose` for initial analysis.
2. `arx_analyze_link_log` when an MSBuild log is available.
3. `arx_analyze_project_link` when project configuration may be involved.
4. `arx_inspect_obj` and `arx_inspect_lib` when actual files are available.
5. `arx_trace_symbol` when the required OBJ and LIB paths are available.

Do not repeat identical queries without a clear reason.

## 4. Evidence and Verification

Clearly distinguish these evidence levels:

1. Search Result Found: An indexed search result exists.
2. Header Declaration Found: The SDK header declares the symbol.
3. LIB Index Match Only: A library index contains a matching symbol.
4. Actual Member OBJ Definition Verified: The relevant object member contains the symbol definition.
5. Final Link Success: An actual build/link operation completed successfully.

These levels are not interchangeable.

In particular:

- A header declaration does not prove that a LIB implements the symbol.
- A LIB index match does not prove that the required object member is usable.
- Static symbol tracing does not prove that the final project links successfully.
- Never claim final link success without an actual build result.

## 5. Tool Output Handling

- Use returned paths, signatures, and diagnostics as evidence.
- Do not invent missing fields or results.
- If results conflict, report the conflict and identify what needs verification.
- Keep output focused on the user's current task.
- Do not expose unrelated SDK documentation or entire knowledge-base contents.

## 6. Safety

All MCP inspection and diagnostic operations should be treated as read-only.

MCP tool results do not authorize source-code changes, project modifications, dependency additions, or build operations.

Follow `project-safety.md` before any approved file modification.

Never execute Build, Rebuild, or Clean automatically.