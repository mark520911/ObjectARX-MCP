# ObjectARX 2024 Local Documentation & Diagnostics MCP

## 1. Project Overview

This project builds a local SQLite/FTS5 knowledge base from legally obtained Autodesk ObjectARX 2024 CHM documentation and SDK inc headers, and exposes it to Claude Code via MCP STDIO for ObjectARX-specific lookup and diagnostics.

Goals:

- Let Claude Code verify official documentation and SDK declarations before writing ObjectARX code, instead of inventing APIs.
- Let Claude Code diagnose compiler, linker, LIB/OBJ symbol issues based on real evidence, instead of blindly adding library dependencies.
- Inject project-level Rules so Claude Code knows when to call which MCP tool.

## 2. Requirements

| Item | Requirement |
| --- | --- |
| OS | Windows 10/11 x64 |
| Node.js | Node.js 22 LTS recommended, minimum 20.11.0 |
| 7-Zip | x64, used for CHM extraction |
| ObjectARX | ObjectARX 2024 SDK (with inc and lib-x64) |
| AutoCAD | AutoCAD 2024 (target platform) |
| IDE | Visual Studio (version is user-configurable; example is VS2026 + v143) |
| MCP client | Claude Code or any MCP STDIO capable client |

Note: This project does not redistribute Autodesk SDK, CHM files, lib-x64, or any Autodesk original materials. Obtain them legally through Autodesk official channels.

## 3. Installation

In PowerShell, change to the project directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

Or install manually:

```powershell
npm install
npm run doctor
```

npm run doctor checks:

- ObjectARX SDK root
- docs directory (where CHM files are)
- inc header directory
- 7-Zip executable
- Node.js version

## 4. Configuration

### 4.1 Use .env for local paths

Copy the template:

```powershell
Copy-Item .env.example .env
```

Edit .env:

```dotenv
ARX_SDK_ROOT=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm
ARX_DOCS_DIR=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm/docs
ARX_INCLUDE_DIR=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm/inc
ARX_7ZIP_PATH=C:/Program Files/7-Zip/7z.exe
ARX_DB_PATH=./data/objectarx.db
```

| Variable | Purpose |
| --- | --- |
| ARX_SDK_ROOT | ObjectARX SDK root |
| ARX_DOCS_DIR | CHM documentation directory |
| ARX_INCLUDE_DIR | SDK inc header directory |
| ARX_7ZIP_PATH | 7-Zip executable |
| ARX_DB_PATH | SQLite database path (relative to project root) |

### 4.2 Configuration priority

1. System environment variables (highest)
2. Project root .env
3. config/default.json (generic defaults, no local paths)

config/config.js loads .env at startup and tolerates UTF-8 BOM.

### 4.3 Files that must not be committed

- .env (local private configuration)
- .mcp.json (local MCP registration)
- data/*.db, source/, converted/, logs/
- backup/ (including backup/transactions/)

These are already excluded by .gitignore. .env.example, .mcp.json.example, and the rule files under .claude/ should be kept and committed.

## 5. Building the Knowledge Base

Build the local index on first use:

```powershell
npm run extract
npm run index
```

Or in one step:

```powershell
npm run rebuild
```

Processing steps:

1. Extract all .chm files under docs into source/ using 7-Zip.
2. Parse HTML and extract titles, body text, and code examples.
3. Produce readable Markdown under converted/.
4. Scan SDK inc headers for symbols.
5. Build data/objectarx.db (SQLite + FTS5).

Important: source/, converted/, and data/objectarx.db must not be committed to a public GitHub repository. They derive from Autodesk documentation or local generation.

## 6. Test & Run

### 6.1 Search tests

```powershell
npm run test:search -- AcEdCommandStack
npm run test:search -- acrxGetApiVersion
```

### 6.2 Full test suite

```powershell
npm test
```

Current test modules:

| Test file | Coverage |
| --- | --- |
| test/lib-parser.test.js | LIB member list and symbol index parsing |
| test/obj-parser.test.js | OBJ symbol table parsing |
| test/symbol-trace.test.js | Symbol tracing and evidence levels |
| test/symbol-trace-runner.test.js | Automated symbol tracing (temp dirs, failure recovery) |
| test/msbuild-inspector.test.js | MSBuild properties and linker configuration read-only checks |
| test/link-error-parser.test.js | LNK2019 / LNK2001 / LNK1104 / LNK1120 parsing |
| test/link-log-parser.test.js | Build and linker log analysis |
| test/mcp-link-log.integration.test.js | arx_analyze_link_log MCP integration |
| test/mcp-project-link.integration.test.js | arx_analyze_project_link MCP integration |

### 6.3 Start the MCP server

```powershell
npm run mcp
```

The server uses STDIO. No terminal output when run directly is expected.

Do not use console.log in server.js or any module called through STDIO; it will corrupt the MCP protocol stream.

## 7. MCP Tools

There are 14 registered MCP tools:

| Tool | Purpose |
| --- | --- |
| arx_search | Search local ObjectARX documentation |
| arx_api_lookup | Exact lookup of ObjectARX API symbols |
| arx_get_section | Read a documentation section by sectionId |
| arx_find_header | Find the SDK header for a symbol |
| arx_search_example | Search C++ code examples |
| arx_diagnose | First-pass compiler/linker error diagnosis |
| arx_inspect_project | Read-only inspection of .vcxproj / .props |
| arx_kb_status | Show knowledge base status |
| arx_environment | Inspect SDK and Visual Studio environment |
| arx_inspect_lib | Inspect LIB members and symbol index |
| arx_inspect_obj | Inspect OBJ symbol table |
| arx_analyze_link_log | Analyze MSBuild build and linker logs |
| arx_trace_symbol | Trace undefined symbols from OBJ to LIB member definitions |
| arx_analyze_project_link | Combined read-only project, log, and symbol diagnostics |

### 7.1 Recommended workflows

API research:

1. arx_api_lookup
2. arx_find_header
3. arx_search
4. arx_search_example
5. arx_get_section (only when a full section is required)

Project configuration inspection:

1. arx_inspect_project
2. arx_environment
3. arx_analyze_project_link

Linker diagnostics:

1. arx_diagnose
2. arx_analyze_link_log (when a log is available)
3. arx_analyze_project_link (when project configuration is involved)
4. arx_inspect_obj / arx_inspect_lib (when actual files are available)
5. arx_trace_symbol (when OBJ and LIB paths are available)

### 7.2 Evidence levels

Tool output distinguishes the following evidence levels, which are not interchangeable:

1. Search Result Found: an indexed search result exists
2. Header Declaration Found: the SDK header declares the symbol
3. LIB Index Match Only: a library index contains a matching symbol
4. Actual Member OBJ Definition Verified: the member OBJ contains the external definition
5. Final Link Success: an actual build or link completed successfully

A header declaration does not prove a LIB implements the symbol; a LIB index match does not prove final linker success; static symbol analysis cannot replace actual build results.

## 8. Connecting to Claude Code

### 8.1 Registration script

Run in the ObjectARX project root:

```powershell
& 'C:\YOUR\PATH\ObjectARX-MCP\scripts\register-claude.ps1' -ProjectPath (Get-Location).Path
```

The candidate version offers three actions:

```powershell
.\register-claude.ps1 -Action Install -TargetProject "C:\MyProject"
.\register-claude.ps1 -Action Update-Rules -TargetProject "C:\MyProject"
.\register-claude.ps1 -Action Uninstall-Rules -TargetProject "C:\MyProject"
```

With no -Action, an interactive menu is shown.

Behavior constraints:

| Action | MCP registration | Rules package | Root CLAUDE.md |
| --- | --- | --- | --- |
| Install | Add or confirm identical | Install | Append managed block |
| Update-Rules | No change | Update | No change |
| Uninstall-Rules | Preserve | Uninstall | Remove managed block |

Additional behavior:

- Does not overwrite a same-named objectarx-docs MCP entry with different settings.
- Does not overwrite user rules under .claude/rules/.
- Shows a full Diff and requires uppercase Y before any change.
- Does not create locks, transaction directories, or target files when the user cancels.
- Transaction backups are kept under ObjectARX-MCP/backup/transactions/.

Script status: the register-claude.ps1 candidate has passed the following static checks:

- Windows PowerShell 5.1 syntax parsing
- No duplicate function definitions
- Statically identifiable named parameters match function definitions
- SHA256 matches the delivered version

However, transaction rollback, failure recovery, File.Replace behavior, and external concurrent modification still require isolated local testing before production use. Do not run an untested candidate on a real project for the first time.

### 8.2 Check MCP connection

```powershell
claude mcp list
```

In Claude Code:

```
/mcp
```

Confirm objectarx-docs is connected.

### 8.3 Rules injection

Reference-style injection (Option A) is used:

- The target project root CLAUDE.md only gains an appended managed block; existing content is preserved.
- The rules package is installed under .claude/objectarx-mcp/, and does not overwrite user rules under .claude/rules/.

Installed layout:

```
TargetProject/
├── CLAUDE.md
├── .mcp.json
└── .claude/
    └── objectarx-mcp/
        ├── CLAUDE.md
        ├── manifest.json
        └── rules/
            ├── api-workflow.md
            ├── mcp-usage.md
            ├── cpp-development.md
            ├── build-and-link.md
            └── project-safety.md
```

Managed block appended to root CLAUDE.md:

```markdown
<!-- OBJECTARX-MCP:BEGIN -->
# ObjectARX-MCP Managed Instructions

@.claude/objectarx-mcp/CLAUDE.md
<!-- OBJECTARX-MCP:END -->
```

## 9. Limitations

1. CHM extraction depends on a locally installed 7-Zip.
2. HTML parsing is bounded by headings and block elements; complex tables or script-generated pages may be incomplete.
3. Header symbol extraction uses rule-based scanning, not a full C++ AST. Macro-generated APIs, templates, and complex overloads may be missed.
4. All search and diagnostic results should be verified against actual SDK headers, LIB files, and project configuration.
5. Tools are read-only by default and do not execute Build / Rebuild / Clean.
6. arx_trace_symbol requires real OBJ and LIB paths; fabricated paths are rejected.
7. Static symbol tracing does not prove final linker success; a success marker in a log does not prove the output file exists.
8. The register-claude.ps1 candidate transaction mechanism cannot defend against disk corruption, power loss, or all external concurrent modifications; it stops and requires manual review when ownership cannot be proven.
9. Uninstall-Rules does not remove the MCP registration from .mcp.json, avoiding impact on other development configurations.

## 10. GitHub Publishing Notes

Before publishing, confirm:

- Do not commit Autodesk original CHM files.
- Do not commit extracted Autodesk content, unauthorized Markdown, or databases.
- Do not commit local SDK, headers, LIB, OBJ, or similar files.
- Do not commit .env, local .mcp.json, personal paths, or credentials.
- Do not commit source/, converted/, data/*.db, logs/, or backup/.
- Commit only project code, generic configuration templates, and necessary documentation.

The @ reference-style rule files (.claude/rules/, CLAUDE.md) are project-owned content and should be committed.

License: This project does not currently provide an open-source license. A public repository does not by itself grant permission to copy, modify, redistribute, or commercially use the code. Contact the author for permission.

Autodesk, ObjectARX, and related SDK content are owned by their respective rights holders. This project is not affiliated with or endorsed by Autodesk.

## 11. FAQ

### 7z not found

Check that 7-Zip is installed and that ARX_7ZIP_PATH in .env points to the correct 7z.exe.

### No CHM files found

Check that ARX_DOCS_DIR points to a directory that actually contains .chm files.

### SQLite native module install failure

Use Node.js 22 LTS x64 and re-run:

```powershell
npm install
```

If the local build environment is missing, install Visual Studio Build Tools and Python 3.12, then run npm rebuild better-sqlite3.

### MCP connected but no search results

Run:

```powershell
npm run doctor
npm run index
```

Confirm data/objectarx.db exists and contains sections and symbols data.

### Cannot load register-claude.ps1 because running scripts is disabled

This is the PowerShell execution policy (RemoteSigned) blocking an unsigned downloaded script. Do not use Set-ExecutionPolicy Bypass as a workaround.

Recommended approach:

1. Use a script created locally or signed by a trusted publisher in a trusted local path.
2. Or prepare a local code signing certificate for test copies only.
3. Complete script security review and isolated testing before production use.

### Better-sqlite3 ABI mismatch

For example:

```
NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 147
```

The native module was compiled for a different Node.js version. Rebuild under the current Node.js:

```powershell
npm rebuild better-sqlite3
```

### ObjectARX-MCP connected but Claude Code does not call tools automatically

Confirm that project-level CLAUDE.md or .claude/rules/ contains tool usage rules; confirm the objectarx-docs name in .mcp.json is correct; run /mcp in Claude Code to check connection status.

## 12. Project Structure

```
ObjectARX-MCP/
├── CLAUDE.md
├── .claude/
│   └── rules/
│       ├── api-workflow.md
│       ├── mcp-usage.md
│       ├── cpp-development.md
│       ├── build-and-link.md
│       └── project-safety.md
├── config/
│   ├── config.js
│   └── default.json
├── scripts/
│   ├── install.ps1
│   └── register-claude.ps1
├── src/
│   ├── server.js
│   ├── db.js
│   ├── doctor.js
│   ├── core/
│   ├── tools/
│   ├── indexer/
│   └── search/
├── test/
├── .env.example
├── .mcp.json.example
├── .gitignore
├── package.json
└── README.md
```

Files generated locally (do not commit):

```
source/
converted/
data/objectarx.db
logs/
backup/
```

## 13. Acknowledgements

- MCP protocol and SDK: @modelcontextprotocol/sdk
- SQLite native binding: better-sqlite3
- HTML parsing: cheerio
- Validation: zod
- Autodesk ObjectARX SDK and documentation are owned by Autodesk.

This project targets ObjectARX 2024 + AutoCAD 2024 x64. All tools are read-only by default and do not modify projects, execute builds, or delete user files automatically.

README version: 1.0 / MCP tools: 14 / Candidate registration script status: static checks passed, pending isolated local testing.