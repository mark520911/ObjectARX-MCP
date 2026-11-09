# ObjectARX 2024 本地文档与诊断 MCP

## 1. 项目简介

本项目将本机合法取得的 Autodesk ObjectARX 2024 CHM 文档与 SDK `inc` 头文件建立为本地 SQLite/FTS5 知识库，并通过 MCP STDIO 为 Claude Code 提供 ObjectARX 专用查询与诊断工具。

核心目标：

- 让 Claude Code 在编写 ObjectARX 代码前查证官方文档与 SDK 声明，而不是凭经验编造 API。
- 让 Claude Code 遇到编译、链接、LIB/OBJ 符号问题时，基于真实证据诊断，而不是盲目添加依赖库。
- 通过项目级 Rules 注入，让 Claude Code 知道什么时候该调用哪个 MCP 工具。

## 2. 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10/11 x64 |
| Node.js | Node.js 22 LTS 推荐，最低 20.11.0 |
| 7-Zip | x64，用于 CHM 解压 |
| ObjectARX | ObjectARX 2024 SDK（含 inc、lib-x64） |
| AutoCAD | AutoCAD 2024（目标开发平台） |
| IDE | Visual Studio（版本由用户配置，示例为 VS2026 + v143） |
| MCP 客户端 | Claude Code 或其他支持 MCP STDIO 的客户端 |

注意：本项目不随仓库分发 Autodesk SDK、CHM 文档、lib-x64 或其他 Autodesk 原始资料。请通过 Autodesk 官方渠道合法获取。

## 3. 安装

在 PowerShell 中进入项目目录：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

或手动安装：

```powershell
npm install
npm run doctor
```

`npm run doctor` 会检查：

- ObjectARX SDK 根目录
- docs 目录（CHM 所在位置）
- inc 头文件目录
- 7-Zip 可执行文件
- Node.js 版本

## 4. 配置

### 4.1 使用 .env 管理本机路径

复制配置模板：

```powershell
Copy-Item .env.example .env
```

编辑 .env：

```dotenv
ARX_SDK_ROOT=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm
ARX_DOCS_DIR=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm/docs
ARX_INCLUDE_DIR=C:/Autodesk/ObjectARX_for_AutoCAD_2024_Win_64bit_dlm/inc
ARX_7ZIP_PATH=C:/Program Files/7-Zip/7z.exe
ARX_DB_PATH=./data/objectarx.db
```

| 变量 | 用途 |
| --- | --- |
| ARX_SDK_ROOT | ObjectARX SDK 根目录 |
| ARX_DOCS_DIR | CHM 文件所在目录 |
| ARX_INCLUDE_DIR | SDK inc 头文件目录 |
| ARX_7ZIP_PATH | 7-Zip 可执行文件 |
| ARX_DB_PATH | SQLite 数据库路径（相对项目根目录） |

### 4.2 配置优先级

1. 系统环境变量（最高）
2. 项目根目录 .env
3. config/default.json（通用默认值，不含本机路径）

`config/config.js` 会在启动时自动加载 .env，并兼容 UTF-8 BOM。

### 4.3 不应提交到 Git 的文件

- .env（本机私有配置）
- .mcp.json（本机 MCP 注册）
- data/*.db、source/、converted/、logs/
- backup/（包括 backup/transactions/）

这些已经在 .gitignore 中排除。.env.example、.mcp.json.example、.claude/ 下的规则文件应当保留并提交。

## 5. 构建知识库

首次使用需要构建本地索引：

```powershell
npm run extract
npm run index
```

或一次性执行：

```powershell
npm run rebuild
```

处理流程：

1. 使用 7-Zip 解压 docs 目录下的全部 .chm 文件到 source/。
2. 解析 HTML，提取标题、正文和代码示例。
3. 生成可审阅的 Markdown 到 converted/。
4. 扫描 SDK inc 头文件符号。
5. 建立 data/objectarx.db（SQLite + FTS5）。

重要：source/、converted/、data/objectarx.db 都不应提交到公开 GitHub 仓库。它们来自 Autodesk 文档或本地生成的衍生内容。

## 6. 测试与启动

### 6.1 检索测试

```powershell
npm run test:search -- AcEdCommandStack
npm run test:search -- acrxGetApiVersion
```

### 6.2 全量测试

```powershell
npm test
```

当前已覆盖的测试模块：

| 测试文件 | 覆盖内容 |
| --- | --- |
| test/lib-parser.test.js | LIB 成员清单、符号索引解析 |
| test/obj-parser.test.js | OBJ 符号表解析 |
| test/symbol-trace.test.js | 符号追踪与证据分级 |
| test/symbol-trace-runner.test.js | 自动符号追踪（含临时目录、失败恢复） |
| test/msbuild-inspector.test.js | MSBuild 属性与链接配置只读检查 |
| test/link-error-parser.test.js | LNK2019 / LNK2001 / LNK1104 / LNK1120 解析 |
| test/link-log-parser.test.js | 构建/链接日志分析 |
| test/mcp-link-log.integration.test.js | arx_analyze_link_log MCP 集成测试 |
| test/mcp-project-link.integration.test.js | arx_analyze_project_link MCP 集成测试 |

### 6.3 启动 MCP 服务

```powershell
npm run mcp
```

服务使用 STDIO。直接运行时终端不显示日志属于正常现象。

禁止在 server.js 或任何被 STDIO 调用的模块中直接使用 console.log 输出普通日志，以免污染 MCP 协议流。

## 7. MCP 工具清单

当前共注册 14 个 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| arx_search | 搜索本地 ObjectARX 文档 |
| arx_api_lookup | 精确查询 ObjectARX API 符号 |
| arx_get_section | 按 sectionId 读取文档章节 |
| arx_find_header | 查找符号对应的 SDK 头文件 |
| arx_search_example | 搜索 C++ 代码示例 |
| arx_diagnose | 编译/链接错误初步诊断 |
| arx_inspect_project | 只读检查 .vcxproj / .props |
| arx_kb_status | 查看知识库状态 |
| arx_environment | 检查 SDK 与 Visual Studio 环境 |
| arx_inspect_lib | 分析 LIB 成员与符号索引 |
| arx_inspect_obj | 分析 OBJ 符号表 |
| arx_analyze_link_log | 分析 MSBuild 构建/链接日志 |
| arx_trace_symbol | 从 OBJ 未定义符号追踪 LIB 成员定义 |
| arx_analyze_project_link | 综合工程、日志与符号的只读链接诊断 |

### 7.1 推荐调用流程

API 查证：

1. arx_api_lookup
2. arx_find_header
3. arx_search
4. arx_search_example
5. arx_get_section（仅在需要完整章节时）

工程配置检查：

1. arx_inspect_project
2. arx_environment
3. arx_analyze_project_link

链接错误诊断：

1. arx_diagnose
2. arx_analyze_link_log（有日志时）
3. arx_analyze_project_link（涉及工程配置时）
4. arx_inspect_obj / arx_inspect_lib（有实际文件时）
5. arx_trace_symbol（可提供 OBJ 和 LIB 路径时）

### 7.2 证据等级

工具输出会明确区分以下证据等级，不允许互相替换：

1. Search Result Found：检索到文档结果
2. Header Declaration Found：SDK 头文件存在声明
3. LIB Index Match Only：LIB 符号索引命中
4. Actual Member OBJ Definition Verified：成员 OBJ 中确认外部定义
5. Final Link Success：真实构建/链接成功

头文件声明不代表 LIB 中有实现；LIB 索引命中不代表最终链接成功；静态符号分析不能替代真实构建结果。

## 8. 连接 Claude Code

### 8.1 注册脚本

在需要开发的 ObjectARX 工程根目录执行：

```powershell
& 'C:\YOUR\PATH\ObjectARX-MCP\scripts\register-claude.ps1' -ProjectPath (Get-Location).Path
```

候选版本提供三种操作：

```powershell
.\register-claude.ps1 -Action Install -TargetProject "C:\MyProject"
.\register-claude.ps1 -Action Update-Rules -TargetProject "C:\MyProject"
.\register-claude.ps1 -Action Uninstall-Rules -TargetProject "C:\MyProject"
```

不带 -Action 时进入交互菜单。

行为约束：

| 操作 | MCP 注册 | 规则包 | 根 CLAUDE.md |
| --- | --- | --- | --- |
| Install | 新增或确认一致 | 安装 | 添加受管区块 |
| Update-Rules | 不修改 | 更新 | 不修改 |
| Uninstall-Rules | 保留 | 卸载 | 移除受管区块 |

其他行为：

- 不覆盖同名但配置不同的 objectarx-docs MCP 项。
- 不覆盖目标工程已有的 .claude/rules/ 用户规则。
- 修改前展示完整 Diff，必须输入大写 Y 才执行。
- 用户取消时不创建锁、事务目录或目标文件。
- 事务备份存放在 ObjectARX-MCP/backup/transactions/。

脚本状态：register-claude.ps1 候选版已通过以下静态检查：

- Windows PowerShell 5.1 语法解析
- 函数定义无重复
- 静态可识别的命名参数与函数定义一致
- SHA256 与交付版本一致

但事务回滚、故障恢复、File.Replace 行为、外部程序并发修改等仍需在本机隔离环境中完成测试后才能用于生产。不要在真实工程上首次运行未经测试的候选脚本。

### 8.2 检查 MCP 连接

```powershell
claude mcp list
```

在 Claude Code 中执行：

```
/mcp
```

确认 objectarx-docs 已连接。

### 8.3 Rules 注入机制

采用引用式注入（方案 A）：

- 目标工程根 CLAUDE.md 只追加受管区块，不覆盖原有内容。
- 规则包安装在独立目录 .claude/objectarx-mcp/，不覆盖用户已有 .claude/rules/。

安装后结构：

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

根 CLAUDE.md 中追加的受管区块：

```markdown
<!-- OBJECTARX-MCP:BEGIN -->
# ObjectARX-MCP Managed Instructions

@.claude/objectarx-mcp/CLAUDE.md
<!-- OBJECTARX-MCP:END -->
```

## 9. 项目限制

1. CHM 解压依赖本机安装的 7-Zip。
2. HTML 解析以标题和块元素为边界，复杂表格或脚本生成页面可能解析不完整。
3. 头文件符号提取采用规则扫描，不是完整 C++ AST。宏生成 API、模板、复杂重载可能漏检。
4. 所有检索与诊断结果都应回到实际 SDK 头文件、LIB 文件和工程配置验证。
5. 工具默认只读，不会自动执行 Build / Rebuild / Clean。
6. arx_trace_symbol 需要真实存在的 OBJ 和 LIB 路径，不接受虚构路径。
7. 静态符号追踪不代表最终链接成功；日志中的链接成功标记也不代表产物文件真实存在。
8. register-claude.ps1 候选版本的事务机制无法抵御磁盘损坏、断电或所有外部程序并发修改；遇到无法证明归属的情况会停止并要求人工检查。
9. register-claude.ps1 的 Uninstall-Rules 不会删除 .mcp.json 中的 MCP 注册，避免影响其他开发配置。

## 10. GitHub 发布注意事项

公开仓库前请确认：

- 不提交 Autodesk 原始 CHM 文件。
- 不提交从 Autodesk 文档提取的原始内容、未经授权的 Markdown 或数据库。
- 不提交本机 SDK、头文件、LIB、OBJ 等文件。
- 不提交 .env、本机 .mcp.json、个人路径或密钥。
- 不提交 source/、converted/、data/*.db、logs/、backup/。
- 仅提交项目自身代码、通用配置模板和必要说明文档。

@ 引用式 Rules 文件（.claude/rules/、CLAUDE.md）属于项目自有内容，应当提交。

许可证：本项目暂未提供开源许可证。公开仓库不代表授予他人复制、修改、再分发或商业使用代码的权限。如需使用，请先取得作者许可。

Autodesk、ObjectARX 及相关 SDK 内容的权利归相应权利人所有。本项目与 Autodesk 没有官方隶属或背书关系。

## 11. 常见问题

### 7z not found

检查 7-Zip 是否安装，并确认 .env 中 ARX_7ZIP_PATH 指向正确的 7z.exe。

### No CHM files found

检查 ARX_DOCS_DIR 是否指向实际包含 .chm 文件的目录。

### SQLite native module install failure

建议使用 Node.js 22 LTS x64，并重新执行：

```powershell
npm install
```

若缺少本地编译环境，可安装 Visual Studio Build Tools 和 Python 3.12，再执行 npm rebuild better-sqlite3。

### MCP connected but no search results

依次执行：

```powershell
npm run doctor
npm run index
```

确认 data/objectarx.db 已生成且包含 sections、symbols 数据。

### 无法加载 register-claude.ps1，因为在此系统上禁止运行脚本

这是 PowerShell 执行策略（RemoteSigned）对未签名下载脚本的限制。不要直接 Set-ExecutionPolicy Bypass。

推荐做法：

1. 在本机受信任路径下使用由你本人创建或受信任签名的脚本。
2. 或为本机测试单独准备代码签名证书，并对脚本副本签名。
3. 生产使用前请先完成脚本安全审查与隔离测试。

### Better-sqlite3 ABI 不匹配

例如：

```
NODE_MODULE_VERSION 127 ... requires NODE_MODULE_VERSION 147
```

说明原生模块是用旧 Node.js 版本编译的。在当前 Node.js 下重新构建：

```powershell
npm rebuild better-sqlite3
```

### ObjectARX-MCP 连接成功，但 Claude Code 没有自动调用工具

确认项目级 CLAUDE.md 或 .claude/rules/ 中存在工具调用规则；确认 .mcp.json 中 objectarx-docs 名称正确；在 Claude Code 中执行 /mcp 检查连接状态。

## 12. 项目结构

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

本机运行后会额外产生（不提交）：

```
source/
converted/
data/objectarx.db
logs/
backup/
```

## 13. 致谢与声明

- MCP 协议与 SDK：@modelcontextprotocol/sdk
- SQLite 原生绑定：better-sqlite3
- HTML 解析：cheerio
- 参数校验：zod
- Autodesk ObjectARX SDK 及文档的权利归 Autodesk 所有。

本项目面向 ObjectARX 2024 + AutoCAD 2024 x64 开发场景，所有工具均以只读诊断为默认边界，不自动修改工程、不自动执行构建、不自动删除用户文件。

README 版本：1.0 / 对应 MCP 工具版本：14 个工具 / 候选注册脚本状态：静态检查通过，待本机隔离环境实测。