# Teleport - Beam Your Claude Code Setup Across Machines

## Context

Users who work with Claude Code across multiple machines face a fragmented experience: plugins, skills, agents, rules, settings, and hooks differ per machine, requiring tedious manual setup each time. Teleport solves this by providing a Claude Code plugin that lets you teleport your entire Claude Code environment — plugins, skills, agents, rules, hooks, and settings — across machines with an agentic, interactive experience.

## Overview

Teleport is an open-source Claude Code plugin that syncs configurations across machines using a private GitHub fork as a central hub. It operates as a set of slash commands within Claude Code sessions, where an agent layer handles user interaction and a deterministic engine layer handles the actual sync logic.

## Architecture

```
+-------------------------------------+
|  Agent Layer (Skills/Commands)       |  <- Interactive UX, questions/choices
|  /teleport-init, sync, push, share  |
+-------------------------------------+
|  Engine Layer (src/)                 |  <- Deterministic logic
|  scanner -> differ -> applier        |
|  secrets filter, backup, git ops     |
+-------------------------------------+
|  Storage Layer                       |
|  Private fork (hub)                  |
|  Public repo (sharing)               |
+-------------------------------------+
```

**Agent Layer**: Skills that converse with the user, determine intent, then issue concrete commands to the Engine.

**Engine Layer**: Same input always produces same output. Once the agent determines what to do, the engine executes deterministically.

**Storage Layer**: Git repositories (private fork for personal hub, optional public repo for sharing).

## Repository Model

```
[teleport/teleport]              (public template - this repo)
       |
       v  gh repo create --private
[user/claude-teleport-hub]       (private - independent repo, not a fork)
       |
    +--+------------------+
    |                     |
    v                     v
 machines/             machines/
  macbook-pro/          work-imac/
    snapshot.yaml         snapshot.yaml
    configs/              configs/
       |
       v  /teleport-share
[user/teleport-public]           (public - curated safe configs for sharing)
```

Each machine gets its own directory in the fork, identified by a machine name that the agent auto-detects (hostname by default, user can override). This enables:

- Per-machine snapshots: see exactly what each machine has
- Selective sync: "bring macbook-pro's agents to this machine"
- Diff across machines: "what does work-imac have that this machine doesn't?"

The agent determines machine identity via `hostname` (or `scutil --get ComputerName` on macOS), and asks the user to confirm or rename on first init.

### Private Repo (Hub)

- Created automatically by `/teleport-init` via `gh repo create --private` (NOT fork — avoids GitHub fork visibility and org policy issues)
- Named `<user>/claude-teleport-hub` to clearly distinguish from the public template
- Stores each machine's configurations under `machines/<machine-id>/configs/`
- Each machine identified by a stable UUID stored in `~/.claude/teleport-machine-id`, with a human-readable alias (editable)
- Machine directory uses the alias slugified (e.g., `macbook-pro`), with UUID in `snapshot.yaml` for deduplication
- A `machines/<machine-id>/snapshot.yaml` records what's installed (auto-generated), includes `teleport_version` field
- Secrets are filtered before committing (never stored in git)

### Public Repo (Sharing)

- Created by `/teleport-share`
- Contains only items explicitly promoted by the user
- Double secret scan before publishing
- Other users reference this via `/teleport-import <user>`

## Syncable Components

All components under `~/.claude/` can be synced selectively:

| Component | Path | Notes |
|-----------|------|-------|
| Plugins | `plugins/installed_plugins.json`, `plugins/known_marketplaces.json` | Metadata only; on sync, agent lists missing plugins with copy-paste install commands. If Claude Code supports programmatic install, use it; otherwise provide manual instructions |
| Skills | `skills/` | SKILL.md files and supporting files |
| Agents | `agents/` | Agent definition markdown files |
| Rules | `rules/` | Language-specific coding standards |
| Commands | `commands/` | Command definition files |
| Settings | `settings.json` | JSON deep merge strategy; credentials excluded |
| CLAUDE.md | `CLAUDE.md` | Global instructions |
| AGENTS.md | `AGENTS.md` | Agent documentation |
| Hooks | `.cursor/hooks.json`, `.cursor/hooks/` | Require explicit review on import |
| Keybindings | `keybindings.json` | Optional |
| MCP configs | `mcp-configs/` | MCP server configurations |

## Commands

### `/teleport-init` (First-time setup)

1. Verify `gh` CLI authentication; if missing, detect OS and provide tailored install/auth commands (brew install gh, apt install gh, etc.) with copy-paste blocks
2. Auto-detect machine name (hostname / ComputerName); sanitize to safe slug; user confirms or renames
3. Generate stable UUID for this machine, store in `~/.claude/teleport-machine-id`
4. Create private repo on GitHub (`gh repo create claude-teleport-hub --private`), push template structure
5. Scan current machine's `~/.claude/` (scanner.ts)
5. Filter secrets (secrets.ts)
6. Present categorized summary; user selects what to export
7. Copy selected items to `machines/<machine-name>/configs/` in fork
8. Generate `machines/<machine-name>/snapshot.yaml`
9. Commit and push

### `/teleport-sync` (Apply configs from hub)

1. Clone or pull private fork
2. Auto-detect current machine name
3. List available machines in fork: "macbook-pro, work-imac, ..."
4. User selects source machine (or "all" for merged view)
5. Compare source `machines/<source>/configs/` vs current `~/.claude/` (differ.ts)
6. Present diff by category with counts
7. User selects categories, then optionally individual items
8. Create backup of current state (backup.ts)
9. Apply selected changes (applier.ts)
10. Detect referenced plugins not installed; offer to install them

### `/teleport-push` (Upload local changes to hub)

1. Scan current `~/.claude/`
2. Auto-detect current machine name
3. Compare with `machines/<machine-name>/` in fork
4. Show changed items with diff preview
5. User selects what to push
6. Secret scan on selected items
7. Update `machines/<machine-name>/snapshot.yaml`
8. Commit and push to fork

### `/teleport-share` (Publish for other users)

1. Scan private fork contents
2. Double secret filtering (automatic + user review)
3. Present items by category; user confirms each for public sharing
4. Create or update `<user>/teleport-public` repo
5. Push curated, safe items only

### `/teleport-import <user>` (Import from another user)

1. Read `<user>/teleport-public` repo
2. Display available categories and items
3. User selects what to import
4. Hooks require mandatory content review and explicit approval
5. Create backup of current state
6. Apply selected items

## Selective Application Principle

Every command follows this interaction pattern:

1. **Categorized overview**: "plugins 3, agents 5, rules 12, settings changes 2"
2. **Category selection**: "Which categories to apply?" (multi-select)
3. **Item-level selection**: "Within agents, which specific ones?"
4. **Preview**: Show diff of what will change before applying
5. **Confirmation**: Final "Proceed with these changes?" before execution

No bulk application without user consent. The agent always presents choices.

## Safety Measures

### Secret Protection

- `.teleportignore` file defines patterns to always exclude (API keys, tokens, credentials)
- Automatic secret scanning using established libraries (truffleHog/detect-secrets patterns) — not hand-rolled regex
- First-time push: mandatory user review gate for every file ("We cannot guarantee no secrets — review before continuing")
- Subsequent pushes: scan only changed files, but flag any new file for review
- `settings.json` credentials keys excluded by default
- Git history awareness: secrets that were ever committed require repo recreation warning

### Backup & Rollback

- Automatic backup to `~/.claude/teleport-backups/<timestamp>/` before any apply operation
- `/teleport-sync` shows how to rollback if something goes wrong
- Backup retention: configurable (default: last 10 snapshots); warn before auto-cleaning; never delete the first-ever backup

### Conflict Resolution

- JSON files: structured key-by-key diff (not raw file diff); group by risk level (auth-related highlighted); per-key-group "keep mine / keep theirs / merge" options
- Non-JSON files: show diff, user chooses which version to keep
- Merge conflicts in git: agent presents both versions, user decides

### Remote Code Execution Prevention

- All imports from external users (hooks, agents, rules, CLAUDE.md) show full content for review — not just hooks
- Hooks never auto-applied; require explicit "I've reviewed this, apply it" confirmation
- Agent definitions and CLAUDE.md flagged if containing shell-like patterns (curl, exec, eval, etc.)
- Hash tracking: if a previously-approved file changes, re-approval required

### Machine-specific Paths

- Path variables (`$HOME`, `$CLAUDE_DIR`) substituted during export/import
- Machine-specific overrides via `settings.local.json` (never synced)

## Plugin Structure

```
teleport/
  plugin.json              # Claude Code plugin definition
  marketplace.json         # Marketplace metadata
  skills/
    teleport/
      SKILL.md             # /teleport main skill (router)
  commands/
    teleport-init.md
    teleport-sync.md
    teleport-push.md
    teleport-share.md
    teleport-import.md
  src/
    scanner.ts             # Scan ~/.claude/ state into structured snapshot
    differ.ts              # Compare two snapshots, produce structured diff
    applier.ts             # Apply diff to local machine (deterministic)
    secrets.ts             # Secret detection and filtering
    backup.ts              # Create/manage backups before apply
    git.ts                 # Git and gh CLI operations wrapper
  templates/
    .gitignore             # Default .gitignore for forks
    .teleportignore        # Default secret patterns
  machines/                # (In user's fork) Per-machine configurations
    macbook-pro/
      snapshot.yaml        # Auto-generated: what's installed on this machine
      configs/
        agents/
        rules/
        skills/
        commands/
        settings.json
        CLAUDE.md
    work-imac/
      snapshot.yaml
      configs/
        ...
```

## Engine Layer Detail

### Scanner (`scanner.ts`)

Produces a `Snapshot` object representing the current state of `~/.claude/`:

```typescript
interface Snapshot {
  teleportVersion: string;     // schema version for migration support
  machineId: string;           // stable UUID from ~/.claude/teleport-machine-id
  machineAlias: string;        // human-readable name (editable)
  plugins: PluginEntry[];      // name, marketplace, version
  marketplaces: Marketplace[]; // name, repo URL
  agents: FileEntry[];         // path, content hash
  rules: FileEntry[];
  skills: FileEntry[];
  commands: FileEntry[];
  settings: object;            // parsed settings.json (secrets redacted)
  globalDocs: FileEntry[];     // CLAUDE.md, AGENTS.md
  hooks: HookEntry[];          // hook definitions
  mcp: FileEntry[];            // MCP configurations
}
```

### Differ (`differ.ts`)

Compares two `Snapshot` objects and produces a `Diff`:

```typescript
interface Diff {
  added: DiffEntry[];     // in source but not target
  removed: DiffEntry[];   // in target but not source
  modified: DiffEntry[];  // in both but different (with content diff)
  unchanged: DiffEntry[]; // same in both
}
```

### Applier (`applier.ts`)

Takes a `Diff` and a user's selection, applies changes:

- File copies for agents, rules, skills, commands
- JSON deep merge for settings
- Plugin install commands for missing plugins
- Marketplace registration for missing marketplaces

## Implementation Language

TypeScript/Node.js, consistent with the Claude Code plugin ecosystem.

## Testing Strategy

- Unit tests for scanner, differ, applier, secrets modules
- Integration tests with mock `~/.claude/` directory
- E2E tests for full init/sync/push cycle using temp git repos
- Secret detection tests with known patterns (API keys, tokens, passwords)

## Verification

To verify the implementation works end-to-end:

1. Run `/teleport-init` on a machine with existing Claude Code configs
2. Verify private fork created on GitHub with correct contents
3. On a different machine (or clean `~/.claude/`), run `/teleport-sync`
4. Verify selected configs are applied correctly
5. Modify a config locally, run `/teleport-push`, verify fork updated
6. Run `/teleport-share`, verify public repo contains only safe items
7. From another account, `/teleport-import <user>`, verify selective import works
8. Test secret filtering: add a fake API key to settings, verify it's caught
9. Test backup: verify `~/.claude/teleport-backups/` created before apply
10. Test conflict: modify same file on two machines, verify merge handling
