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
- `/teleport-update` — Push unpushed local changes to your private hub (and optionally the public repo)
- `/teleport-share` — Publish safe configs to a public repo for others
- `/teleport-from <username>` — Import configs from another user's public repo
- `/teleport-push` — Deprecated alias for `/teleport-update`; retained for backward compatibility

Use `AskUserQuestion` (single-select) to ask which command to run. Options:
- **teleport-init** — "First-time setup: create hub repo, scan and export environment"
- **teleport-pull** — "Pull configs from your hub to this machine"
- **teleport-update** — "Push unpushed local changes to private hub (and optionally public repo)"
- **teleport-share** — "Publish safe configs to a public repo for others"
- **teleport-from** — "Import configs from another user's public repo"

Then invoke the corresponding skill. Do not list `teleport-push` as a choice —
it is kept only as a deprecation alias for existing muscle memory and will
route to `teleport-update` automatically when called directly.
