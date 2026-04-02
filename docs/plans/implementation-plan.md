# Teleport Implementation Plan

## Context

Users working with Claude Code across multiple machines face fragmented environments. Teleport is a Claude Code plugin that lets users sync their entire setup (plugins, skills, agents, rules, hooks, settings) across machines via a private GitHub repo as a central hub. The spec is at `docs/superpowers/specs/2026-04-02-teleport-design.md`.

The repo is currently empty. We're building a TypeScript-based Claude Code plugin from scratch.

## Architecture: Skills call Engine via CLI

Skills (markdown) instruct Claude to invoke compiled TypeScript via Bash:
```
Skill SKILL.md → Claude runs `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <subcommand>` → JSON output → Claude presents conversationally
```

This keeps the engine deterministic and testable, and the agent layer conversational.

### Plugin Root Resolution

`CLAUDE_PLUGIN_ROOT` is injected by Claude Code when executing a plugin's skill, pointing to the plugin's install directory. Skills reference the CLI via `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`. If unset (local dev), the skill instructs Claude to search `~/.claude/plugins/cache/` for the teleport plugin directory. Verified in Phase 7 testing.

### Data Transport Protocol

Large data (snapshots, diffs, selections) is passed via **temp files**, never CLI arguments:
```
node dist/cli.js scan --output /tmp/teleport-scan.json
node dist/cli.js diff --source-file /tmp/a.json --target-file /tmp/b.json --output /tmp/diff.json
node dist/cli.js apply --diff-file /tmp/diff.json --selections-file /tmp/sel.json
```
- CLI reads from `--*-file` flags, writes to `--output` or stdout (for small responses)
- Skills use `Write` to create temp files, `Bash` to invoke CLI, `Read` to read output
- Temp files cleaned up after use

### Shared Skill Patterns

Skills share two reusable patterns referenced by name instead of repeated inline:

**Hub-connect preamble** (used by sync, push, share):
1. `context` → get auth status + machine info in one call. If not authenticated, show OS-specific `gh` install/auth guidance. STOP until resolved.
2. Clone or pull hub repo to `/tmp/teleport-hub-<random>`. Store as `hubPath`.

**Secret-scan gate** (used by init, push, share):
1. Run `secret-scan --snapshot-file <snap> --output <tmp>`. Read findings.
2. If findings: show each with file/line. Auto-exclude unless user overrides.

## Dependency Graph

```
Phase 1: Scaffolding + Types
    |
    +---> Phase 2: Machine + Paths + Secrets + Differ  (all parallel, no mutual deps)
    |
    +---> Phase 3: Scanner (depends on 2: machine identity)
    +---> Phase 4: Backup + Applier (depends on 2: paths)
    +---> Phase 5: Git Operations (depends on 3, 2: scanner + secrets)
    |
    +---> Phase 6: CLI Entry Point (depends on all engine phases)
    +---> Phase 7: Plugin + Skills + Docs (depends on 6)
```

**Node.js requirement**: ≥18.x (for `crypto.randomUUID()`, stable ESM).

---

## Phase 1: Project Scaffolding + Types

**Goal**: Git init, TypeScript compiles, types defined, one test passes.

**Files**:
- `.gitignore` — node_modules/, .env, *.local.json (`dist/` is NOT gitignored — committed so plugin works without npm install)
- `package.json` — name: teleport, type: module, scripts: build (tsc), test (node --test), prepare (npm run build). DevDeps: typescript, @types/node. `dist/` committed to git.
- `tsconfig.json` — target ES2022, module NodeNext, outDir ./dist, rootDir ./src, strict true
- `src/types.ts`:
  - `FileEntry` { relativePath, contentHash, content? }
  - `PluginEntry` { name, marketplace, version? }
  - `Marketplace` { name, repoUrl }
  - `HookEntry` { name, event, command, config? }
  - `Snapshot` { teleportVersion, machineId, machineAlias, plugins, marketplaces, agents, rules, skills, commands, settings, globalDocs, hooks, mcp, keybindings? }
  - `DiffEntry` { category, relativePath, type: 'added'|'removed'|'modified'|'unchanged', sourceContent?, targetContent?, riskLevel? }
  - `Diff` { added, removed, modified, unchanged }
  - `BackupManifest` { timestamp, claudeDir }
  - `TeleportConfig` { hubRepoName, machineId, machineAlias, hubLocalPath }
  - `ApplyResult` { applied: Array<{path, status, error?}>, pluginInstructions, marketplaceInstructions }
  - `SecretFinding` { file, line, pattern, severity, match }
- `src/constants.ts` — TELEPORT_VERSION, CLAUDE_DIR, TELEPORT_MACHINE_ID_FILE, TELEPORT_BACKUPS_DIR, HUB_REPO_SUFFIX, category-to-path mappings, default `.teleportignore` entries (settings.local.json, .credentials.json, sessions/, debug/, telemetry/, history.jsonl)

**Verify**: `npm run build` succeeds, `npm test` passes.

---

## Phase 2: Machine Identity + Paths + Secrets + Differ

**Goal**: Four independent modules built in parallel. Machine identity, path substitution, secret detection, and snapshot diffing.

### `src/machine.ts`
- `getMachineAlias()`: `scutil --get ComputerName` (macOS) → fallback `hostname` → sanitize to slug
- `getMachineId()`: read `~/.claude/teleport-machine-id` or generate UUID via `crypto.randomUUID()`
- `setMachineAlias(alias)`: update alias

### `src/paths.ts`
- `substituteForExport(content)`: absolute paths → `$HOME`/`$CLAUDE_DIR` variables
- `substituteForImport(content)`: variables → absolute paths

### `src/secrets.ts`
- `loadIgnorePatterns(path?)` — reads `.teleportignore`
- `scanForSecrets(entries: FileEntry[]): SecretFinding[]` — data-driven pattern registry modeled after truffleHog/detect-secrets (AWS keys, GitHub tokens, Slack tokens, Stripe keys, PEM keys, generic API keys, bearer tokens, high-entropy base64)
- `filterSecrets(snapshot, patterns): Snapshot`
- `isCredentialKey(key): boolean` — for settings.json
- `scanForRcePatterns(content): string[]` — flags shell-like patterns (curl, wget, eval, exec, child_process, rm -rf, sudo, pipe to sh/bash) in agents/hooks/CLAUDE.md

### `src/differ.ts`
- `diff(source, target): Diff` — compares two Snapshots
- Per-category: file-based (path + hash), plugins (name+marketplace), settings (key-by-key with risk levels), hooks (name+event)
- Modified entries include human-readable content diff

### `templates/.teleportignore`
Default exclusion patterns.

### Tests
- `src/__tests__/machine.test.ts`, `paths.test.ts`, `secrets.test.ts`, `differ.test.ts`

**Verify**: UUID gen, slug sanitization, path round-trip, secret detection (true + false positives), RCE pattern flagging, diff scenarios.

---

## Phase 3: Scanner

**Goal**: Scan `~/.claude/` into a Snapshot.

**Files**:
- `src/scanner.ts`
  - `scanClaudeDir(claudeDir?): Promise<Snapshot>` — main entry
  - Generic `scanDirectory(dir, opts?)` handles agents, rules, skills, commands, mcp, globalDocs via config (path + extension filter)
  - Special-case helpers: `scanPlugins()`, `scanSettings()` (excludes settings.local.json + credential keys), `scanHooks()`, `scanKeybindings()`
  - Content hashing via `crypto.createHash('sha256')`
  - Missing dirs → empty arrays. Binary files → skip with warning.
- `src/__tests__/scanner.test.ts` — mock `~/.claude/` in temp dir

**Verify**: Valid Snapshot from mock dir. Empty dir handled gracefully.

---

## Phase 4: Backup + Applier

**Goal**: Create backups before apply, apply selected diff entries.

**Files**:
- `src/backup.ts`
  - `createBackup(claudeDir?): Promise<BackupManifest>`
  - `listBackups()`, `restoreBackup(timestamp)`, `cleanOldBackups(keep)` — never delete first-ever backup
- `src/applier.ts`
  - `applyDiff(selections: DiffEntry[], claudeDir?): Promise<ApplyResult>`
  - File categories: copy files. Settings: JSON deep merge. Plugins: generate install command strings. Hooks: only if flagged as reviewed.
  - Path variable substitution on import
- `src/__tests__/backup.test.ts`, `src/__tests__/applier.test.ts`

**Verify**: Full round-trip: scan mock A → diff vs mock B → apply → verify files match.

---

## Phase 5: Git Operations

**Goal**: Create hub repo, clone, pull, push, manage per-machine directories.

**Files**:
- `src/git.ts`
  - `checkGhAuth(): Promise<{authenticated, username?, os, ghInstalled}>` — OS detection for install guidance
  - `getGhUsername()`
  - `createHubRepo(username)` — `gh repo create <user>/claude-teleport-hub --private`; idempotent (checks if exists first, returns existing URL if so, with `{created: boolean, repoUrl}`)
  - `cloneOrPullHub(username, localPath)` — clone if not exists, pull if exists
  - `pushToHub(localPath, message)`
  - `writeSnapshotToHub(snapshot, hubPath, machineAlias)` — writes to `machines/<alias>/configs/`; UUID collision detection (appends UUID suffix if alias taken by different machine). Writes inline snapshot.yaml metadata sidecar (teleportVersion, hashes, timestamps).
  - `readSnapshotFromHub(hubPath, machineAlias): Promise<Snapshot>` — missing dir → empty snapshot
  - `listMachines(hubPath): Promise<Array<{alias, id, lastPush}>>`
  - `createPublicRepo(username)` — for /teleport-share
- `templates/.gitignore` — template for hub repo

**Verify**: Local git round-trip. Idempotent create. Alias collision detection.

---

## Phase 6: CLI Entry Point

**Goal**: Single CLI that skills invoke via `node dist/cli.js <subcommand>`.

**File**: `src/cli.ts`

| Subcommand | Input | Output | Notes |
|------------|-------|--------|-------|
| `context` | — | `{auth: {authenticated, username, os, ghInstalled}, machine: {id, alias}}` stdout | Replaces separate gh-check + machine-info |
| `scan --claude-dir <path> --output <file>` | — | Snapshot file | |
| `diff --source-file <f> --target-file <f> --output <f>` | 2 Snapshots | Diff file | source=what you want, target=what you have |
| `apply --diff-file <f> --selections-file <f>` | Diff + selections | ApplyResult stdout | |
| `backup --claude-dir <path>` | — | BackupManifest stdout | |
| `backup-list` | — | BackupManifest[] stdout | |
| `backup-restore --timestamp <ts>` | — | Status stdout | |
| `secret-scan --snapshot-file <f> --output <f>` | Snapshot | SecretFinding[] file | |
| `rce-scan --file <path>` | Single file | RCE findings stdout | Per-file for import review |
| `hub-init` | — | `{created, repoUrl, localPath}` stdout | Idempotent |
| `hub-push --hub-path <p> --machine <a> --snapshot-file <f> --selections-file <f>` | Snapshot + selections | Status stdout | Reads snapshot for file contents |
| `hub-machines --hub-path <path>` | — | Machine list stdout | |

**12 subcommands** (down from 18). Removed: `gh-check`, `machine-info` (→ `context`), `diff-from-hub`, `diff-to-hub` (skills compose `scan` + `diff`), `hub-exists` (→ `hub-init` idempotent), `check-approvals`, `approve` (deferred to v0.2.0).

**Verify**: Each subcommand works. `scan` tested with 50+ file snapshot.

---

## Phase 7: Plugin + Skills + Docs

**Goal**: Installable Claude Code plugin, all 5 commands working, docs complete.

**Files**:

- `.claude-plugin/plugin.json`:
  ```json
  { "name": "teleport", "description": "Beam your Claude Code setup across machines", "version": "0.1.0", "author": { "name": "seil" }, "license": "MIT" }
  ```

- `.claude-plugin/marketplace.json`:
  ```json
  { "name": "teleport", "owner": { "name": "seil" }, "plugins": [{ "name": "teleport", "description": "Sync Claude Code environment across machines", "source": "./" }] }
  ```

- `skills/teleport/SKILL.md` — Router: explains subcommands, delegates.

- `skills/teleport-init/SKILL.md`:
  1. Run `context`. If not authenticated → show OS-specific guidance. STOP until resolved.
  2. Show detected machine alias, ask user to confirm or rename.
  3. Run `hub-init`. If `created=false`: "Hub already exists. Using existing."
  4. `scan --output <tmp>`. Present categorized summary.
  5. Ask: "Which categories to export?" (multi-select). "Any specific items to exclude?"
  6. Run **secret-scan gate**.
  7. **First-push review gate**: show file list, user confirms.
  8. `hub-push --hub-path <path> --machine <alias> --snapshot-file <snap> --selections-file <sel>`.
  9. Show success + next steps.

- `skills/teleport-sync/SKILL.md`:
  1. Run **hub-connect preamble**.
  2. `hub-machines --hub-path <hubPath>`. Present sources with timestamps. User picks source.
  3. `scan --output /tmp/local.json`. Then `diff --source-file <hub-machine-snap> --target-file /tmp/local.json --output /tmp/diff.json`. (Skill reads hub machine's snapshot from `<hubPath>/machines/<source>/configs/` via Read tool.)
  4. Present diff by category with counts.
  5. User selects categories → items. Show diff preview for modified.
  6. For hooks/agents/CLAUDE.md from another machine: `rce-scan --file <path>` for each. Show flagged lines. Require explicit yes.
  7. `backup`. Show backup path.
  8. `apply --diff-file <tmp> --selections-file <sel>`. Show result.
  9. If plugins need installing: show copy-paste commands.
  10. Clean up temp files.

- `skills/teleport-push/SKILL.md`:
  1. Run **hub-connect preamble**.
  2. `scan --output /tmp/local.json`.
  3. Read hub machine snapshot from `<hubPath>/machines/<alias>/`. `diff --source-file /tmp/local.json --target-file <hub-snap> --output /tmp/diff.json`.
  4. If empty: "Hub is up to date." STOP.
  5. Present changes by category. User selects.
  6. Run **secret-scan gate** on local snapshot.
  7. First push from this machine? → review gate.
  8. `hub-push --hub-path <hubPath> --machine <alias> --snapshot-file /tmp/local.json --selections-file <sel>`.
  9. Show success. Clean up.

- `skills/teleport-share/SKILL.md`:
  1. Run **hub-connect preamble**.
  2. Read all machine configs from hub. Build deduplicated union (latest-pushed wins on collision).
  3. Present by category. User selects what to share publicly.
  4. Run **secret-scan gate** on selections.
  5. `rce-scan` on each agent/hook/CLAUDE.md. Show flagged lines. Require explicit yes.
  6. Item-by-item preview (first 10 lines). User confirms each.
  7. Create/pull public repo. Write items. Commit and push.
  8. Show success.

- `skills/teleport-import/SKILL.md`:
  1. Clone `<user>/teleport-public` to temp dir. Scan. Present categories.
  2. User selects. **Mandatory content review for ALL files** with `rce-scan`.
  3. `backup`. `apply`. Show result. Clean up.

- `README.md` — installation, usage, architecture
- `LICENSE` — MIT

Each skill follows **Selective Application Principle**: categorized overview → category selection → item selection → preview → confirmation.

**Verify**: Install locally. All slash commands appear. E2E `/teleport-init` on existing and empty `~/.claude/`.

---

## Critical Files

| File | Purpose |
|------|---------|
| `src/types.ts` | Foundation interfaces |
| `src/scanner.ts` | Core engine: reads ~/.claude/ state |
| `src/cli.ts` | Bridge between skills and engine |
| `skills/teleport-init/SKILL.md` | Primary user-facing command |
| `.claude-plugin/plugin.json` | Plugin identity |

## Key Design Decisions

- **CLI bridge**: deterministic, testable, clean separation from agentic UX
- **Zero production dependencies**: Node.js built-ins only (fs, path, crypto, child_process)
- **Skills format** over commands: spec shows `commands/`, plan uses `skills/<name>/SKILL.md` — both valid; skills preferred for new plugins, allows supporting files
- **Private repo** (not fork): avoids GitHub fork visibility and org policy issues
- **UUID machine identity**: stable across hostname changes, slug alias for display
- **dist/ committed**: plugin works without npm install
- **Deferred to v0.2.0**: approval hash tracking (persistent RCE re-approval), git history secret scanning

## Changes from Pre-Simplification Plan

| What | Before | After | Rationale |
|------|--------|-------|-----------|
| Phases | 10 | 7 | Merged parallel modules, combined docs with plugin |
| CLI subcommands | 18 | 12 | Removed redundant direction variants, folded hub-exists, combined gh-check+machine-info |
| Source files | ~12 | ~9 | Inlined snapshot-yaml into git.ts, deferred git-history.ts and approval tracking |
| Skill prose | 3-4 repeated blocks | Shared patterns referenced by name | Hub-connect preamble, secret-scan gate |
| Scanner helpers | 7 per-category | Generic scanDirectory + 3 special-case | Collapsed file-based scanners |
| BackupManifest | 4 fields | 2 fields | Removed derivable machineAlias, itemCount |
