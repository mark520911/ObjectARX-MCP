# ObjectARX 2024 Local Documentation MCP (Node.js)

本项目将 Autodesk ObjectARX CHM 文档与本机 SDK `inc` 头文件建立本地 SQLite/FTS5 知识库，并通过 MCP STDIO 提供 Claude Code 查询工具。

## 功能
- CHM 批量解压（调用本机 7-Zip）
- HTML 标题/正文/代码示例提取
- SQLite FTS5 文档全文检索
- 从 SDK `inc` 扫描常见 Ac* 类、枚举及 acrx/aced/acut/acdb 等函数符号
- MCP 工具：`arx_search`、`arx_api_lookup`、`arx_get_section`、`arx_find_header`、`arx_search_example`、`arx_diagnose`、`arx_kb_status`
- 错误诊断只给证据和排查方向，不自动改工程

## 1. 环境
- Windows 10/11 x64
- Node.js 22 LTS（最低 20.11）
- 7-Zip x64
- ObjectARX 2024 SDK 已解压
- Claude Code

## 2. 配置路径
编辑 `config/default.json`，确认：
- `sdkRoot`：ObjectARX 2024 根目录
- `docsDir`：CHM 文件所在的 `docs` 目录（截图所示解压目录；它可以与已安装 SDK 根目录不同）
- `includeDir`：其中的 `inc` 目录
- `sevenZipPath`：7z.exe 路径

也可通过环境变量覆盖：`ARX_SDK_ROOT`、`ARX_DOCS_DIR`、`ARX_INCLUDE_DIR`、`ARX_7ZIP_PATH`、`ARX_DB_PATH`。

## 3. 安装依赖
在 PowerShell 进入项目目录：
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```
或者：
```powershell
npm install
npm run doctor
```

## 4. 构建知识库
```powershell
npm run extract
npm run index
```
或一次执行：
```powershell
npm run rebuild
```
第一次运行会把 docs 下所有 `.chm` 解压到 `source`，解析 HTML、导出可审阅的 Markdown 到 `converted`，并建立 `data/objectarx.db`。如果 SDK 目录中存在 `inc`，也会扫描头文件符号。

## 5. 测试
```powershell
npm run test:search -- AcEdCommandStack
```
启动 MCP：
```powershell
npm run mcp
```
该进程使用 STDIO，直接运行后终端不会显示普通日志是正常的；不要在 server.js 中添加 console.log（会污染 MCP STDIO）。

## 6. 连接 Claude Code
在要开发的 ObjectARX 项目根目录运行：
```powershell
& 'E:\ObjectARX-MCP\scripts
egister-claude.ps1' -ProjectPath (Get-Location).Path
```
如果 MCP 项目不在 `E:\ObjectARX-MCP`，从实际目录运行：
```powershell
& '你的项目目录\scripts\register-claude.ps1' -ProjectPath '你的ObjectARX工程目录'
```
脚本会在项目根目录生成/更新 `.mcp.json`，不覆盖其他 MCP server。
然后运行：
```powershell
claude mcp list
```
进入 Claude Code 后执行 `/mcp`，确认 `objectarx-docs` 已连接。
把本项目的 `CLAUDE.md` 内容复制到你的 ObjectARX 工程根目录 `CLAUDE.md`（若已有文件则合并，不要覆盖原有规则）。

## 7. MCP 工具调用建议
- API 不熟悉：`arx_api_lookup(symbol)`
- 查头文件：`arx_find_header(symbol)`
- 文档检索：`arx_search(query, topK=5)`
- 读取全文：`arx_get_section(sectionId)`
- 查代码示例：`arx_search_example(query)`
- 编译/链接错误：`arx_diagnose(error,symbol,configuration,platform)`
- 知识库状态：`arx_kb_status()`

## 8. 重要限制
1. CHM 解压依赖 7-Zip；如果 CHM 内页面是非标准格式，个别页面可能解析不完整。
2. 当前 HTML 解析以章节标题和块元素为边界，遇到复杂表格/脚本生成页面时应抽查原始页面。
3. 头文件符号提取采用规则扫描，不是完整 C++ AST；宏生成 API、模板、重载签名可能漏检。搜索结果必须回到实际头文件验证。
4. 本版没有自动修改 Visual Studio 工程，也不会自动添加 LIB。自动修复工程属于高风险动作，先输出 diff 并经用户批准。
5. Autodesk SDK 文档版权归 Autodesk 所有。知识库仅供你在合法取得的本地 SDK 文档范围内使用，不应公开分发原始文档或数据库。

## 9. 常见问题
### `7z` not found
安装 7-Zip，或在 `config/default.json` 指定 `sevenZipPath`。
### `No CHM files found`
检查 `docsDir` 是否指向实际的 `docs` 文件夹。
### SQLite native module install failure
建议使用 Node.js 22 LTS x64，并重新执行 `npm install`。若机器未安装构建工具，可先升级 npm 并使用官方 Node x64 安装包。
### MCP connected but no search results
先执行 `npm run doctor`，再确认 `npm run index` 成功，并检查 `data/objectarx.db` 是否生成且包含 sections。
