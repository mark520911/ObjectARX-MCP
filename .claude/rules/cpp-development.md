# ObjectARX C++ Development Rules

## 1. Language and Compatibility

- Use native C++ with ObjectARX.
- Default target: AutoCAD 2024 x64 and ObjectARX 2024 SDK.
- Follow the actual Visual Studio version and Platform Toolset configured by the user.
- Do not introduce .NET, managed C++, or other frameworks unless explicitly requested.
- Do not silently use APIs or language features unsupported by the actual project toolchain.

## 2. API and Type Safety

- Verify unfamiliar ObjectARX classes, functions, macros, enums, and signatures against the installed SDK.
- Use the exact namespaces, class scopes, parameter types, return types, and calling conventions declared by the SDK.
- Do not invent typedefs, aliases, or replacement declarations to suppress compiler errors.
- Do not assume that similarly named APIs have identical signatures across SDK versions.
- Include the appropriate SDK headers rather than relying on accidental transitive includes.

## 3. ObjectARX Database and Object Lifetimes

When working with the AutoCAD database:

- Follow ObjectARX ownership and object-lifetime requirements.
- Open database objects using the appropriate SDK-supported mechanisms.
- Close or release objects according to the documented ownership rules.
- Use transactions and database operations according to the actual API contract.
- Check error statuses and handle failure paths.
- Avoid dangling pointers, double releases, invalid object IDs, and use-after-close errors.
- Do not assume that a pointer returned by an API is owned by the caller.

Verify the relevant SDK documentation when ownership or lifetime semantics are uncertain.

## 4. Memory and Resource Management

- Prefer clear ownership and deterministic cleanup.
- Use RAII where compatible with the ObjectARX API and object ownership model.
- Do not mix incompatible allocation and deallocation mechanisms.
- Handle file handles, database objects, iterators, and other resources safely.
- Avoid unnecessary global state and unmanaged resource lifetimes.

## 5. Character Sets and String Handling

- Respect the character types and build configuration used by the installed SDK.
- Do not arbitrarily mix `char`, `wchar_t`, `TCHAR`, and ObjectARX string types.
- Verify the relevant macros and function overloads before changing string-related code.
- Avoid unsafe encoding conversions and assumptions about the active character set.

## 6. Error Handling and Diagnostics

- Check `Acad::ErrorStatus` and other relevant return values.
- Report meaningful failure information.
- Do not silently ignore failed database operations.
- For compiler or linker errors, follow the relevant diagnostic workflow instead of making speculative code changes.
- Distinguish a source-code correction from a project configuration or linker correction.

## 7. Code Quality

- Keep functions focused and avoid unnecessary complexity.
- Use meaningful names consistent with the existing project.
- Preserve existing project architecture unless a redesign is requested.
- Avoid unnecessary dependencies and undocumented workarounds.
- Add comments for non-obvious ObjectARX behavior, ownership, or compatibility decisions.
- Do not rewrite unrelated source files when fixing a localized issue.

## 8. Modification Restrictions

Do not modify source files automatically.

Follow the **work-unit git workflow** in `project-safety.md` §2 (one feature or one bug fix per unit): do not create a git checkpoint for every individual edit.

Before changing C++ source code (at work-unit start / before applying a batch):

1. Inspect the relevant source and related declarations.
2. Verify unfamiliar APIs against ObjectARX 2024.
3. Ensure git context is valid and establish the **single baseline checkpoint ref** for the work unit if not already created (see `project-safety.md` §2). Do not repeat per edit within the same work unit.
4. Show the proposed Diff for the work-unit batch (e.g. `git diff -- <paths>` / `git diff <baseline-ref> -- <paths>`).
5. Wait for explicit user approval for the stated scope.

After approved changes, verify the result (`git diff --stat` / file inspection). At work-unit completion, report the baseline ref/SHA (if any) and verification; create **one** commit only with explicit user authorization (see `project-safety.md` §2, §8).