# ObjectARX Project Safety Rules

## 1. Default Read-Only Policy

Treat all project inspection and diagnostic operations as read-only by default.

The following actions require explicit user authorization:

- Creating, editing, deleting, or moving project files.
- Modifying C++ source files.
- Modifying `.vcxproj`, `.props`, or `.def` files.
- Changing include directories or library dependencies.
- Modifying SDK files or build configurations.
- Executing Build, Rebuild, or Clean.
- Installing, updating, or removing project rules.
- Creating git commits or pushing to a remote.

Do not interpret a request to diagnose an error as permission to modify files or execute builds.

## 2. Work-Unit Git Safety Workflow (Feature / Bug Fix)

The project under development **must be a git repository**. Git is the required safety mechanism, but actions are scoped to a **work unit** (completing one feature or fixing one bug), not to every individual edit.

**Do not** create a git checkpoint for every file modification or every small edit.

### 2.1 Work-unit start (baseline, once per unit)

Before the first modification in a work unit:

1. Identify the target files/scope and inspect their current content.
2. Verify git context: `git rev-parse --is-inside-work-tree` must succeed. If it fails, **stop** and ask the user to run `git init` (and create an initial commit if needed). Do not proceed with ad-hoc file copies or SHA256 manifests.
3. Record the baseline: current `HEAD` (or note "no commits yet") and `git status --short`.
4. **Establish one baseline checkpoint ref** for the whole work unit (recommended rollback anchor). Create it using a **temporary index** so the user's real index and hooks are untouched:
   1. Set a unique temporary `GIT_INDEX_FILE`.
   2. `git read-tree <HEAD>` (or `--empty` if there is no commit yet).
   3. `git add -- <path>` for in-scope existing paths as needed to capture the baseline state.
   4. `TREE=$(git write-tree)`
   5. `COMMIT=$(git commit-tree $TREE -m "objectarx-mcp work-unit baseline <UTC-ts>" [-p HEAD])`
   6. `git update-ref refs/objectarx-mcp/checkpoints/<UTC-ts>-<6hex> $COMMIT`
   Record: ref and commit SHA. **Do not repeat this for subsequent edits within the same work unit.**

### 2.2 During the work unit (batched edits)

1. Prepare the proposed changes for the current batch.
2. Show the Diff for the stated scope (e.g. `git diff -- <paths>` and/or `git diff <baseline-ref> -- <paths>`).
3. Wait for explicit user approval for that batch/scope. Approval for the stated work-unit scope authorizes the listed changes; it does not authorize unrelated files or actions.
4. Apply only the approved changes. Multiple small edits within the same work unit do **not** require new checkpoint refs.
5. If a change goes wrong mid-unit: stop further modifications, explain the issue, and (with user approval) roll back using `git diff` / `git restore -- <path>` or by restoring from the baseline ref. Do not create per-edit checkpoints.

### 2.3 Work-unit completion (milestone)

When the feature is complete or the bug is fixed and verified:

1. Verify the final result: inspect modified files, review `git diff --stat` / `git diff` for affected paths, and confirm only intended changes remain.
2. Report: baseline ref/SHA (if created), files changed, and verification result.
3. **Commit only with explicit user authorization**: if authorized, create **one** git commit for the completed work unit with a clear message describing the feature or bug fix. Do not commit or push without explicit authorization.
4. If not authorized to commit, leave changes in the working tree and report status clearly.

## 3. Post-Modification Verification

After an approved modification or at work-unit completion:

1. Read the modified files again.
2. Verify that the intended changes were applied.
3. Check that unrelated content was preserved.
4. Verify against git as appropriate:
   - `git diff --stat -- <paths>`
   - `git diff -- <paths>` / compare to `<baseline-ref>` when useful
   - if a commit was created (with authorization), verify the commit contains only the intended work-unit changes.
5. Report: baseline ref/SHA (if created), commit SHA (if created with authorization), and verification result.
6. Report any verification failures.

Do not claim successful modification without verifying the resulting files.

## 4. Rollback

If a modification causes an unexpected problem:

- Stop further modifications.
- Explain the difference between the current state and the intended/baseline state (`git diff`, `git diff <baseline-ref> -- <path>` as applicable).
- Obtain user approval before restoring.
- Restore as appropriate: `git restore -- <path>`, `git restore --source=<baseline-ref> -- <path>`, or `git show <baseline-commit>:<path> > <path>` if restore is unsuitable.
- Verify the restored file(s) (e.g. `git diff --exit-code <baseline-ref> -- <path>` when applicable).

Never overwrite a newer user modification without explicit approval.

## 5. Build and Execution Safety

Never execute Build, Rebuild, or Clean without explicit user authorization.

Do not execute scripts that modify project files without explaining their effects and obtaining approval.

Before running installation or update scripts, inspect their behavior and identify affected paths.

## 6. User Data and Secrets

- Never publish `.env`, local `.mcp.json`, private credentials, access tokens, or passwords.
- Never expose private SDK paths or unrelated personal project paths in public examples.
- Preserve existing user configuration.
- Do not overwrite existing `CLAUDE.md` or user-created rules without explicit approval.
- Do not delete user data, databases, SDK documentation, or source archives as part of routine cleanup.

## 7. Minimal Change Principle

- Make only the smallest change necessary.
- Do not reformat unrelated files.
- Do not replace a complete configuration file when a targeted edit is sufficient.
- Do not perform unrelated cleanup during a requested fix.
- Keep a clear record of changed files.

## 8. Final Reporting

For every approved work unit / modification batch, report:

- Work unit scope (feature or bug fix).
- Files changed.
- Baseline checkpoint ref and commit SHA (if created).
- Git commit SHA (only if a commit was explicitly authorized and created).
- Verification results (`git diff` / comparison to baseline / commit verification as applicable).
- Any remaining risks or uncompleted steps.

Never report an unverified change as successful.
