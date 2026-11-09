# ObjectARX 2024 Development Instructions

## 1. Project Environment

- Target: AutoCAD 2024 x64.
- SDK: ObjectARX 2024.
- Language: Native C++ ObjectARX.
- IDE: User-configurable Visual Studio version.
- Platform Toolset: User-configurable.
- MCP Server: `objectarx-docs`.

The default development target is AutoCAD 2024 x64 with ObjectARX 2024 SDK.

Do not assume a specific Visual Studio version or compiler toolset. Follow the actual project configuration.

## 2. Mandatory Development Principles

1. Never invent ObjectARX APIs, classes, functions, signatures, enum values, header paths, or library names.
2. Verify ObjectARX-specific claims against the local SDK or indexed documentation.
3. Distinguish verified facts from assumptions and hypotheses.
4. Preserve AutoCAD 2024 compatibility unless the user explicitly requests another target.
5. Prefer the smallest safe change that solves the actual problem.
6. Do not claim a build or link succeeded without an actual successful build result.

## 3. MCP Tool Usage

Use the `objectarx-docs` MCP server whenever a task depends on:

- ObjectARX APIs or SDK headers.
- Official ObjectARX documentation or examples.
- SDK and Visual Studio environment inspection.
- ObjectARX project configuration.
- Compiler and linker diagnostics.

Do not use ObjectARX-MCP for ordinary C++ questions unrelated to ObjectARX.

Select tools according to the task. Do not call every tool unnecessarily.

If the MCP server is unavailable or a tool call fails, state this clearly. Never claim that a tool or SDK inspection was completed when it was not.

## 4. File Modification Safety

Treat project inspection and diagnostics as read-only by default.

Never execute Build, Rebuild, or Clean without explicit user authorization.

Before modifying project files, source files, configuration files, or SDK-related files:

1. Inspect the original file.
2. Create a backup.
3. Record the original SHA256.
4. Present the proposed changes and Diff.
5. Wait for explicit user approval.

After an approved modification, verify the result and report the new SHA256.

Never blindly add LIB dependencies, use `/NODEFAULTLIB`, or modify Visual Studio project settings.

## 5. Rules Index

Follow the applicable rules under `.claude/rules/`:

- `api-workflow.md`: API lookup, SDK header verification, and documentation research.
- `mcp-usage.md`: MCP tool selection and evidence requirements.
- `cpp-development.md`: Native C++ and ObjectARX development practices.
- `build-and-link.md`: Visual Studio configuration, compilation, and linker diagnostics.
- `project-safety.md`: Read-only inspection, backup, Diff, approval, and rollback.

These rules supplement this file. If a conflict occurs, follow the more restrictive safety requirement.

## 6. Response Requirements

For ObjectARX-related conclusions:

- Identify the evidence and its source.
- Distinguish verified facts from hypotheses.
- Explain missing evidence or inspection limitations.
- Recommend the smallest safe next step.
- Never report an unverified result as successful.