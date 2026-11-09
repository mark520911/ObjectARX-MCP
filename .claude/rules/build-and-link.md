# ObjectARX Build and Link Diagnostic Rules

## 1. Build Environment

Default target:

- AutoCAD 2024 x64.
- ObjectARX 2024 SDK.
- Visual Studio version: user-configurable.
- Platform Toolset: user-configurable.

Always inspect the actual project configuration before proposing build-related changes.

Do not assume that the IDE version determines the Platform Toolset.

## 2. Initial Diagnostic Workflow

When the user reports compiler or linker errors:

1. Obtain the exact error message and relevant build output.
2. Call `arx_diagnose` for initial analysis.
3. Call `arx_analyze_link_log` if an MSBuild log is available.
4. Call `arx_inspect_project` to inspect relevant `.vcxproj` or `.props` settings.
5. Call `arx_analyze_project_link` when project configuration or dependency relationships need deeper analysis.
6. Verify every proposed correction against the installed SDK and actual project files.

Do not recommend changes based only on an error message when the required evidence is available for inspection.

## 3. Project Configuration Verification

Check relevant settings when applicable:

- Configuration: Debug or Release.
- Platform: x64.
- Platform Toolset.
- Runtime Library.
- Preprocessor Definitions.
- Additional Include Directories.
- Additional Library Directories.
- Additional Dependencies.
- Module Definition File.
- Target Machine.
- ObjectARX SDK version and directory layout.

Check for inconsistent settings between configurations and platforms.

Do not assume Debug and Release use identical dependencies or runtime settings.

## 4. LIB and OBJ Verification

Before recommending a LIB dependency:

1. Verify that the file exists in the installed SDK.
2. Inspect the relevant library when supported.
3. Determine whether the required symbol is present.
4. Inspect the corresponding object member when possible.
5. Verify architecture and compatibility.

Use `arx_inspect_lib`, `arx_inspect_obj`, and `arx_trace_symbol` only when the actual files are available.

Never infer a LIB filename from a class name or header declaration.

Never invent SDK library paths.

## 5. Linker Evidence Levels

Every linker conclusion must identify its evidence level:

1. **Header Declaration Found**: The symbol is declared in an SDK header.
2. **LIB Index Match Only**: A library index contains a matching symbol.
3. **Actual Member OBJ Definition Verified**: The relevant object member contains the required definition.
4. **Final Link Success**: The actual project completes linking successfully.

A higher evidence level requires actual evidence. Do not promote a lower level into a higher one by inference.

Static symbol inspection cannot prove final linker success.

## 6. Common Linker Error Handling

For unresolved external symbols:

- Verify the exact decorated or undecorated symbol.
- Check calling convention, parameter types, namespaces, and class scope.
- Verify the matching SDK declaration.
- Check whether the implementation is available in the installed SDK libraries.
- Inspect project dependencies and library search paths.
- Check architecture and configuration consistency.
- Distinguish missing implementation, incorrect signature, missing dependency, and configuration mismatch.

For missing LIB file errors:

- Verify the exact file path.
- Confirm the library exists in the installed SDK.
- Check the configured library directories.
- Do not substitute another LIB based on its filename alone.

For runtime library conflicts:

- Inspect the actual runtime library settings.
- Verify configuration consistency.
- Do not blindly use `/NODEFAULTLIB` to suppress warnings or errors.

## 7. Build Execution Restrictions

Do not execute Build, Rebuild, or Clean without explicit user authorization.

Diagnostics, project inspection, and static symbol analysis do not authorize a build operation.

Do not claim that a linker problem is fixed until an actual successful build result is available.

## 8. Project Modification Restrictions

Never automatically modify:

- `.vcxproj`
- `.props`
- `.def`
- C++ source files
- SDK files
- Include directories
- Library directories
- Additional Dependencies
- Runtime Library settings

Before an approved modification:

1. Inspect the original configuration.
2. Back up the affected file.
3. Record the original SHA256.
4. Present the exact proposed Diff.
5. Wait for explicit user approval.

After approval, apply only the approved changes and verify the resulting file and SHA256.