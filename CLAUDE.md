# Teleport — CLAUDE.md

Claude Code plugin that syncs your entire Claude Code environment across machines using a private GitHub repo as a hub.

## Core Design Philosophy: Skills call Engine via CLI

This is the single most important thing to understand about this codebase:

```
Skill (SKILL.md)
    -> Claude reads it, runs:
       node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <subcommand> --flags
    -> CLI outputs JSON to stdout
    -> Claude reads JSON, presents results conversationally
```

Skills are the **conversational layer** (markdown in `skills/`).
The TypeScript CLI (`src/cli.ts` -> `dist/cli.js`) is the **deterministic engine**.
They are deliberately separate: the engine is testable and pure; the agent layer is human-friendly.

### Why dist/ is committed to git

`dist/` is NOT in `.gitignore`. It is committed so the plugin works immediately after
`/plugin install` without requiring `npm install` or a build step on the user's machine.
Always run `npm run build` and commit `dist/` before pushing a release.

### CLAUDE_PLUGIN_ROOT

Claude Code injects `CLAUDE_PLUGIN_ROOT` when executing a plugin skill — it points to the
plugin's install directory (e.g., `~/.claude/plugins/cache/claude-teleport/`).
Skills reference the CLI as: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`.
If unset (local dev), skills fall back to searching `~/.claude/plugins/cache/` for the dir.

### Data Transport: Temp Files, Not CLI Args

Large payloads (snapshots, diffs, selections) are passed via temp files, never as args:

```bash
node dist/cli.js scan --output /tmp/teleport-scan.json
node dist/cli.js diff --source-file /tmp/a.json --target-file /tmp/b.json --output /tmp/diff.json
node dist/cli.js apply --diff-file /tmp/diff.json --selections-file /tmp/sel.json
```

Skills use Write to create input files, Bash to invoke the CLI, Read to consume output.
Temp files must be cleaned up after use.

## Quick Commands

```bash
npm run build        # tsc -> dist/
npm test             # node --import tsx --test src/__tests__/**/*.test.ts
```

No linter configured. TypeScript strict mode is the primary quality gate.

## Architecture

The core is a pure pipeline:

```
~/.claude  ->  scan  ->  Snapshot (JSON)  ->  diff  ->  DiffEntry[]  ->  apply  ->  ~/.claude
                                                                              |
                                                              backup created before every apply
```

And a hub layer on top:

```
Local Snapshot  ->  hub-push  ->  GitHub (private repo, per-machine branch)
                                         |
                              merge to main on every push
                                         |
                              hub-pull  ->  diff against local  ->  user selects entries  ->  apply
```

Each machine gets its own git branch (`<alias>-<machineId>`). `main` is the union of all machines.

## Key Files

| File | Role |
|---|---|
| `src/scanner.ts` | Scans `~/.claude`, builds `Snapshot` |
| `src/differ.ts` | Diffs two `Snapshot` objects, returns `Diff` |
| `src/applier.ts` | Applies selected `DiffEntry[]` to local machine |
| `src/backup.ts` | Backup/restore of `~/.claude` before apply |
| `src/secrets.ts` | Secret pattern scan + RCE pattern scan on content |
| `src/git.ts` | All GitHub hub operations (clone, push, pull, branch) |
| `src/machine.ts` | Machine ID/alias resolution |
| `src/paths.ts` | Path helpers for `~/.claude` subdirs |
| `src/constants.ts` | All constants — edit here, nowhere else |
| `src/types.ts` | All TypeScript interfaces |
| `src/cli.ts` | CLI entrypoint — `teleport <command> --flags`, outputs JSON to stdout |
| `src/utils.ts` | `hashContent`, `scanDirectoryToFileEntries` |

## Types

Core types in `src/types.ts`:

- `Snapshot` — full serialized state of a machine's `~/.claude`
- `FileEntry` — `{ relativePath, contentHash, content? }`
- `DiffEntry` — `{ category, relativePath, type: added|removed|modified|unchanged, riskLevel }`
- `Diff` — `{ added, removed, modified, unchanged, summary }`
- `TeleportConfig` — stored in `~/.claude/teleport-machine-id`

## Constants (src/constants.ts)

- `CLAUDE_DIR` — `~/.claude`
- `PRIVATE_REPO_NAME` — `claude-teleport-private`
- `PUBLIC_REPO_NAME` — `claude-teleport-public`
- `CATEGORY_PATHS` — maps category name to subdir in `~/.claude`
- `GLOBAL_DOC_FILES` — `["CLAUDE.md", "AGENTS.md"]` (synced at root)
- `DEFAULT_IGNORE_PATTERNS` — never synced (credentials, history, etc.)
- `SECRET_PATTERNS` — regex patterns for secrets scan (AWS, GitHub tokens, PEM keys, etc.)
- `RCE_PATTERNS` — dangerous shell patterns flagged in imported hooks/agents
- `CREDENTIAL_KEYS` — key names stripped from `settings.json` before snapshot

## Code Conventions

- **Strict TypeScript** — no `any`, no implicit returns, explicit return types
- **Readonly everywhere** — all interfaces use `readonly`, arrays use `readonly T[]`
- **No mutation** — functions return new objects; do not mutate inputs
- **ESM** — `"type": "module"` in package.json; always import with `.js` extension (even for `.ts` source)
- **Node built-ins** — use `node:fs`, `node:path`, `node:os` etc. with explicit `node:` prefix
- **Error handling** — `try/catch` at boundaries only; propagate errors up to CLI layer
- **CLI outputs JSON** — `cli.ts` writes `JSON.stringify(data, null, 2)` to stdout, errors to stderr, then exits

## Safety Rules

Every operation involving external content must follow:

1. **Secret scan before push** — call `scanForSecrets()` on snapshot; abort if critical findings
2. **RCE scan before apply** — call `scanForRcePatterns()` on hooks and agents from external sources
3. **Backup before apply** — always call `createBackup()` before `applyDiff()`
4. **Never sync credentials** — `settings.local.json`, `.credentials.json`, `*.local.json`, `.env*` are in `DEFAULT_IGNORE_PATTERNS` and must never be committed

## Git Hub Flow

- Remote: `gh` CLI for repo creation and auth (`gh auth status`)
- Branch naming: `sanitizeBranchName()` enforces `[a-zA-Z0-9._\-/]+`, no `..`, no leading `-`
- Timeouts: `TELEPORT_GIT_TIMEOUT` (local, default 30s), `TELEPORT_GIT_REMOTE_TIMEOUT` (remote, default 120s)
- Push flow: write snapshot JSON to branch -> commit -> push -> merge to `main`
- Public share flow: separate `claude-teleport-public` repo; only curated/safe content goes there

## Skills (Claude Code slash commands)

Located in `skills/`:
- `teleport-init` — first-time setup, creates private hub
- `teleport-pull` — pull from hub to local
- `teleport-push` — push local to hub
- `teleport-update` — incremental sync (only unpushed changes)
- `teleport-share` — publish to public repo
- `teleport-from` — import from another user's public repo
- `teleport` — top-level dispatcher

## Adding a New Synced Category

1. Add to `CATEGORY_PATHS` in `src/constants.ts`
2. Add scan logic in `src/scanner.ts` -> `scanClaudeDir()`
3. Add the field to `Snapshot` interface in `src/types.ts`
4. Handle the category in `src/applier.ts` -> `applyDiff()`
5. Add test in `src/__tests__/scanner.test.ts`
