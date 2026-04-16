<p align="center">
  <img src="assets/banner.svg" alt="Teleport — Beam your Claude Code setup across machines" width="900"/>
</p>

# Teleport

Beam your Claude Code setup across machines.

Teleport is a Claude Code plugin that syncs your entire environment — plugins, skills, agents, rules, hooks, and settings — across machines using a private GitHub repo as a central hub.

## Quick Start

1. **Add the marketplace** in Claude Code:
   ```
   /plugin marketplace add seilk/claude-teleport
   ```

2. **Install the plugin**:
   ```
   /plugin install claude-teleport
   ```

3. **Initialize** on your first machine:
   ```
   /claude-teleport:teleport-init
   ```

4. **Pull** on another machine:
   ```
   /claude-teleport:teleport-pull
   ```

## Commands

| Command | Description |
|---------|-------------|
| `/claude-teleport:teleport-init` | First-time setup: create private hub, export your config |
| `/claude-teleport:teleport-pull` | Pull configs from hub to this machine |
| `/claude-teleport:teleport-update` | Push unpushed local changes to private hub (and optionally public repo) |
| `/claude-teleport:teleport-share` | Publish safe configs for others to import |
| `/claude-teleport:teleport-from <user>` | Import from another user's public repo |
| `/claude-teleport:teleport-push` | **Deprecated** alias for `/teleport-update`; prefer `/teleport-update` |

## How It Works

```
[Your Machine A]  --push-->  [claude-teleport-private]  <--pull--  [Your Machine B]
                              branch: macbook-pro
                              branch: work-imac
                              branch: main (merged)
                                     |
                                     v  /claude-teleport:teleport-share
                             [claude-teleport-public]  <--from--  [Other Users]
                              branch: main (curated)
```

### Branch-based storage

Each machine gets its own **git branch**. When you push, your machine's branch is updated and then merged into `main`.

- `main` branch = union of all machines (merged)
- `macbook-pro` branch = Machine A's configs only
- `work-imac` branch = Machine B's configs only

When pulling, you choose which machine's branch to pull from — or use `main` for everything.

## What Gets Synced

- Plugins (install metadata)
- Marketplaces (plugin sources)
- Skills, Agents, Rules, Commands
- Settings (credentials excluded)
- CLAUDE.md, AGENTS.md
- Hooks (with review gate)
- MCP configs
- Keybindings

## Safety

- Secrets auto-detected (AWS keys, GitHub tokens, PEM keys, etc.)
- `settings.local.json` and `.credentials.json` never synced
- Backup created before every apply operation
- RCE patterns flagged in imported hooks/agents
- All external imports require per-file content review

## Updating

### When a new version is released (version bump)

```bash
# 1. Update the marketplace catalog (pulls latest from GitHub)
claude plugin marketplace update claude-teleport

# 2. Update the installed plugin
claude plugin update claude-teleport@claude-teleport

# 3. Restart Claude Code to apply
```

### When only commits changed (no version bump)

`claude plugin update` compares the **version string** in `plugin.json`, not the git commit SHA.
If the upstream repo has new commits but the version hasn't changed, `plugin update` will say
"already at the latest version" and skip.

To force-update in this case:

```bash
# 1. Update the marketplace catalog
claude plugin marketplace update claude-teleport

# 2. Delete the cached snapshot (force re-copy on next install)
rm -rf ~/.claude/plugins/cache/claude-teleport/

# 3. Reinstall from the updated marketplace
claude plugin install claude-teleport@claude-teleport

# 4. Restart Claude Code to apply
```

> **Tip:** You can verify what's installed vs. what's available:
> ```bash
> # Check installed version and commit SHA
> claude plugin list
>
> # Check marketplace HEAD
> cd ~/.claude/plugins/marketplaces/claude-teleport && git log --oneline -1
> ```

## Requirements

- Node.js >= 18
- GitHub CLI (`gh`) authenticated
- Claude Code

## License

MIT
