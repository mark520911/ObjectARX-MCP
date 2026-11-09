# ObjectARX API Research Workflow

## 1. When API Verification Is Required

Use this workflow whenever:

- An ObjectARX API is unfamiliar.
- A class, function, enum, or method signature is uncertain.
- API availability or compatibility with ObjectARX 2024 is unclear.
- A linker or compiler error may involve an API declaration or implementation.
- The user requests official ObjectARX documentation or SDK evidence.

Do not apply this workflow to ordinary C++ questions unrelated to ObjectARX.

## 2. Mandatory API Lookup

For an unfamiliar or uncertain API:

1. Call `arx_api_lookup` using the exact symbol.
2. Call `arx_find_header` to verify the actual SDK header path.
3. Call `arx_search` to obtain relevant official documentation when additional context is needed.
4. Call `arx_search_example` when implementation examples are useful.
5. Call `arx_get_section` only when the complete documentation section is required.

Do not call every tool mechanically. Select the minimum tools needed to establish reliable evidence.

## 3. SDK Verification

- Verify declarations against the installed ObjectARX 2024 SDK.
- Check namespaces, class scope, parameter types, return types, const qualifiers, calling conventions, and macros when relevant.
- Do not assume that an API from another AutoCAD or ObjectARX version exists in ObjectARX 2024.
- Do not infer implementation availability from a header declaration.
- Do not infer LIB ownership from API names or header locations.

If the knowledge base has no result, explicitly report the missing result and inspect the installed SDK when accessible.

Never fabricate header paths, documentation sections, API signatures, or compatibility claims.

## 4. Documentation Evidence

When presenting an API conclusion:

- Identify the exact symbol.
- Provide the verified header path when available.
- Identify the relevant documentation or example source.
- Distinguish local SDK evidence from indexed documentation evidence.
- State when the evidence is incomplete or unavailable.

Prefer concise evidence and relevant excerpts over loading entire manuals.

## 5. Code Example Requirements

Before presenting ObjectARX code:

1. Verify unfamiliar APIs and signatures.
2. Confirm the target SDK version.
3. Check required headers and relevant dependencies.
4. Avoid unsupported or invented declarations.
5. Clearly identify assumptions that cannot be verified locally.

Examples from other SDK versions must be labeled as such and must not be presented as verified ObjectARX 2024 code.

## 6. Failure and Uncertainty Handling

If lookup or verification fails:

- State which lookup or verification step failed.
- Do not silently substitute a guessed API.
- Request the relevant local header, documentation, or build evidence when necessary.
- Provide a safe next step based on available evidence.

A missing search result does not prove that an API does not exist.