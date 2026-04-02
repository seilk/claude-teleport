---
name: teleport
description: "Beam your Claude Code setup across machines. Routes to the appropriate teleport command."
allowed-tools: [Bash, Read, Write]
---

# Teleport

Sync your Claude Code environment (plugins, skills, agents, rules, hooks, settings) across machines.

## Available Commands

- `/teleport-init` — First-time setup: create private hub repo, scan and export your environment
- `/teleport-pull` — Pull configs from your hub to this machine
- `/teleport-push` — Push local changes to your hub
- `/teleport-share` — Publish safe configs to a public repo for others
- `/teleport-from <username>` — Import configs from another user's public repo

Ask the user which command they'd like to run, then invoke the corresponding skill.
