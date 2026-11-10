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

### Work-unit git workflow (feature / bug fix)

Do **not** create a git checkpoint for every individual edit. Git actions are scoped to a **work unit**: completing one feature or fixing one bug (which may span multiple files and multiple small edits).

**At the start of a work unit** (before the first modification):
1. Inspect the relevant original files and confirm git context (`git rev-parse --is-inside-work-tree`). If not a git repository, stop and ask the user to run `git init` (and make an initial commit if needed). Do not fall back to ad-hoc file copies.
2. Record the baseline: `HEAD` (or note no commits yet) and `git status --short` so the starting state is known.
3. **Establish one baseline checkpoint ref** for the whole work unit (recommended rollback anchor): create `refs/objectarx-mcp/checkpoints/<UTC-timestamp>-<random>` using a temporary `GIT_INDEX_FILE` with `git read-tree` / `add` / `write-tree` / `commit-tree` / `update-ref`. This does **not** touch the user's real index and does **not** trigger user git hooks. Record the ref and commit SHA. **Do not repeat this for subsequent edits within the same work unit.**

**During the work unit** (multiple edits allowed):
4. Prepare and present the proposed changes and Diff for the work-unit batch (e.g. `git diff -- <paths>` and/or `git diff <baseline-ref> -- <paths>`), clearly stating scope.
5. Wait for explicit user approval for that batch/scope before applying. Approval for the stated work-unit scope authorizes the listed changes; it does not authorize unrelated files or actions.
6. If a change goes wrong mid-unit, stop and roll back using `git diff` / `git restore -- <path>` or by restoring from the baseline ref (with user approval), instead of creating per-edit checkpoints.

**At the end of the work unit** (feature complete or bug fixed and verified):
7. Verify the final result (inspect files, review `git diff --stat` / `git diff` for the affected paths).
8. Report: baseline ref/SHA (if created), files changed, and verification result.
9. If the user explicitly authorizes it, create **one** git commit for the completed work unit with a clear message describing the feature or bug fix. Do not commit or push without explicit user authorization. If not authorized, leave changes uncommitted and report status.

Never blindly add LIB dependencies, use `/NODEFAULTLIB`, or modify Visual Studio project settings.

## 5. Rules Index

Follow the applicable rules under `.claude/rules/`:

- `api-workflow.md`: API lookup, SDK header verification, and documentation research.
- `mcp-usage.md`: MCP tool selection and evidence requirements.
- `cpp-development.md`: Native C++ and ObjectARX development practices.
- `build-and-link.md`: Visual Studio configuration, compilation, and linker diagnostics.
- `project-safety.md`: Read-only inspection, work-unit git safety (baseline checkpoint, Diff, approval, rollback, and milestone commit on authorization).

These rules supplement this file. If a conflict occurs, follow the more restrictive safety requirement.

## 6. Response Requirements

For ObjectARX-related conclusions:

- Identify the evidence and its source.
- Distinguish verified facts from hypotheses.
- Explain missing evidence or inspection limitations.
- Recommend the smallest safe next step.
- Never report an unverified result as successful.