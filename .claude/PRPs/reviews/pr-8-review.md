# PR Review: #8 — fix: support Claude Code v2 plugin format and enrich plugin management

**Reviewed**: 2026-04-07
**Author**: seilk
**Branch**: fix/plugin-management-v2-format → main
**Decision**: APPROVE with comments

## Summary

Solid bug fix that addresses a real silent failure — `scanPlugins()` and `scanMarketplaces()` were returning `[]` because Claude Code migrated to a v2 object-keyed format. The fix adds proper v2 parsing with v1 backward compat, enriches types, improves diffing (version + enabled state), and generates actionable CLI commands from the applier. Well-tested with 15 new test cases covering the core changes.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

1. **[scanner.ts:79] Race condition on settings.json reads**
   `scanPlugins()` reads `settings.json` for `enabledPlugins`, and `scanMarketplaces()` reads it again for `extraKnownMarketplaces`. Both also go through `scanSettings()`. That's 3 independent reads of the same file. If the file is being written concurrently (e.g. by Claude Code), you could get inconsistent data. Consider reading settings.json once and passing it through.

2. **[applier.ts:52-58,70-77] Repeated settings.json read-modify-write without locking**
   `updateSettings()` does read → modify → write on every call. When applying multiple plugin/marketplace entries, this creates a hot path of repeated file I/O. If two entries write simultaneously (future parallel apply), last-write-wins. Currently sequential so safe, but fragile. Consider batching settings updates.

3. **[git.ts:210-230] Duplicate utility functions**
   `hashContent()`, `isTextFile()`, `scanDirToFileEntries()` in `git.ts` duplicate the same functions from `scanner.ts`. Should extract to a shared `utils.ts` to avoid drift.

4. **[scanner.ts:76] `enabledPlugins` type assumption**
   The test in `scanner.test.ts:45` sets `enabledPlugins` to an array `["superpowers"]`, but `scanPlugins()` treats it as `Record<string, boolean>`. The test passes because `Object.assign` on an array produces `{ "0": "superpowers" }` which never matches the `"name@marketplace"` key. This is not a bug per se, but the mock doesn't reflect the actual v2 format. The v2-specific test at line 96 is correct (`{ "superpowers@official": true }`).

5. **[git.ts:286-330] `readSnapshotFromDir` handles v2 format in hub but inconsistently**
   For `installed_plugins.json`, it handles both flat array (teleport hub format) and v2 Claude Code format. For `known_marketplaces.json`, it handles array and object formats. This is good for backward compat, but the comment says "shouldn't appear in hub" for v2 — consider logging a warning when encountering unexpected formats.

### LOW

1. **[types.ts:63] `SecretSeverity` formatting**
   `export type SecretSeverity="***" | "high" | "medium";` — missing space around `=`. Minor style inconsistency.

2. **[scanner.ts:68] Truncated line in source**
   `const isCredential=CREDEN...(ck) =>` appears truncated in the diff. Likely a display issue but worth verifying the actual source compiles correctly. (Build passes, so this is fine.)

3. **dist/ files committed**
   The PR includes 8 `dist/` build artifacts. Consider whether these should be in `.gitignore` and built in CI instead. If intentional (plugin distribution), that's fine.

4. **[differ.ts] `JSON.stringify` for deep comparison**
   `diffMarketplaces()` and `diffSettings()` use `JSON.stringify()` for deep equality. This works but is order-dependent for objects. Consider a deep-equal utility for robustness.

## Validation Results

| Check | Result |
|---|---|
| Type check (tsc) | Pass |
| Lint | Skipped (no lint script) |
| Tests (node:test) | 84/106 pass (22 pre-existing failures in cli.test.ts and git.test.ts — environment issues, not PR-related) |
| Build | Pass |

Note: The 22 test failures are all pre-existing:
- `cli.test.ts` (9 failures): `spawnSync /bin/sh ENOENT` — sandbox environment issue
- `git.test.ts` (13 failures): `git push origin main` fails because `git init` defaults to `master` branch — test setup issue predating this PR

All PR-specific tests pass:
- scanner.test.ts: 14/14 ✓
- differ.test.ts: 12/12 ✓
- applier.test.ts: 9/9 ✓

## Files Reviewed

| File | Change | Lines |
|---|---|---|
| src/types.ts | Modified | +28 (enriched PluginEntry, new MarketplaceSource, Marketplace) |
| src/scanner.ts | Modified | +120 (v2 plugin/marketplace parsing, enabledPlugins, extraKnownMarketplaces) |
| src/differ.ts | Modified | +80 (diffPlugins version+enabled, new diffMarketplaces) |
| src/applier.ts | Modified | +100 (CLI command generation, settings.json writes) |
| src/git.ts | Modified | +150 (v2 format handling in hub read/write, backward compat) |
| src/__tests__/scanner.test.ts | Modified | +90 (v2, enabled state, marketplace, dedup tests) |
| src/__tests__/differ.test.ts | Modified | +70 (version/enabled diff, marketplace diff tests) |
| src/__tests__/applier.test.ts | Modified | +80 (CLI commands, enabledPlugins, marketplace apply tests) |
| dist/* (8 files) | Modified | Build artifacts |
