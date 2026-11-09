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

Do not interpret a request to diagnose an error as permission to modify files or execute builds.

## 2. Mandatory Modification Workflow

Before modifying an existing file:

1. Identify the exact target file.
2. Inspect its current content.
3. Create a timestamped backup.
4. Calculate the original SHA256.
5. Prepare the proposed changes.
6. Show the exact Diff.
7. Wait for explicit user approval.

Only modify the files and sections explicitly approved by the user.

Approval for one file does not authorize changes to other files.

## 3. Post-Modification Verification

After an approved modification:

1. Read the modified file again.
2. Verify that the intended changes were applied.
3. Check that unrelated content was preserved.
4. Calculate the resulting SHA256.
5. Report the backup path and both hashes.
6. Report any verification failures.

Do not claim successful modification without verifying the resulting file.

## 4. Rollback

If a modification causes an unexpected problem:

- Stop further modifications.
- Identify the affected file and backup.
- Explain the difference between the current file and its backup.
- Obtain user approval before restoring the backup.
- Verify the restored file and its SHA256.

Never overwrite a newer user modification with an older backup without explicit approval.

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

For every approved modification, report:

- Files changed.
- Files backed up.
- Original SHA256.
- New SHA256.
- Verification results.
- Any remaining risks or uncompleted steps.

Never report an unverified change as successful.