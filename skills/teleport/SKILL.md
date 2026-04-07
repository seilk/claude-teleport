---
name: teleport
description: "Beam your Claude Code setup across machines. Routes to the appropriate teleport command."
allowed-tools: [Bash, Read, Write, AskUserQuestion]
---

# Teleport

Sync your Claude Code environment (plugins, skills, agents, rules, hooks, settings) across machines.

## Available Commands

- `/teleport-init` — First-time setup: create private hub repo, scan and export your environment
- `/teleport-pull` — Pull configs from your hub to this machine
- `/teleport-push` — Push local changes to your hub
- `/teleport-update` — Update already-pushed private/public repos with local changes
- `/teleport-share` — Publish safe configs to a public repo for others
- `/teleport-from <username>` — Import configs from another user's public repo

Use `AskUserQuestion` (single-select) to ask which command to run. Options:
- **teleport-init** — "First-time setup: create hub repo, scan and export environment"
- **teleport-pull** — "Pull configs from your hub to this machine"
- **teleport-push** — "Push local changes to your hub"
- **teleport-update** — "Update already-pushed private/public repos with unpushed local changes"
- **teleport-share** — "Publish safe configs to a public repo for others"
- **teleport-from** — "Import configs from another user's public repo"

Then invoke the corresponding skill.
