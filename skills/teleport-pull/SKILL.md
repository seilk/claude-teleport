---
name: teleport-pull
description: "Pull configs from your hub to this machine"
allowed-tools: [Bash, Read, Write, AskUserQuestion]
---

# Teleport Pull

Pull configurations from your private hub to this machine.

## Steps

1. **Hub-connect preamble**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" context`. Verify auth. Store `username` and `machineAlias`. Clone or pull: `git clone https://github.com/<username>/claude-teleport-private /tmp/teleport-hub-<random>` (or `git pull` if already present). Store path as `hubPath`.

2. **List machines**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-machines --hub-path <hubPath>`. This reads `registry.yaml` from main (no branch checkout needed). Use `AskUserQuestion` (single-select) to let the user pick a machine. Options: each machine name with last-push timestamp as description (e.g. "macbook-pro (pushed 2h ago)"), plus "main (merged union of all machines)".

3. **Read machine + diff**: If user picked a specific machine, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-read-branch --hub-path <hubPath> --branch <selected> --output /tmp/hub-snap.json` (returns full snapshot with content from `machines/<alias>/`). Alternatively, to read from main without branch checkout: `hub-read-main --hub-path <hubPath> --machine <alias> --output /tmp/hub-snap.json`. Then scan local: `scan --output /tmp/local.json`. Then `diff --source-file /tmp/hub-snap.json --target-file /tmp/local.json --output /tmp/diff.json`.

4. **Present diff**: Read diff file. Show by category: "From macbook-pro: +5 agents, +12 rules, ~3 settings, +2 plugins".

5. **User selects**: Use `AskUserQuestion` with `multiSelect: true` to present changed categories. Then for each selected category, use another `AskUserQuestion` with `multiSelect: true` listing specific items (show diff preview for modified items in the description).

6. **RCE scan**: For hooks/agents/CLAUDE.md: run `rce-scan --file <path>`. If findings: show flagged lines. Require explicit yes.

7. **Backup**: Run `backup --claude-dir ~/.claude`. Show backup path.

8. **Apply**: Write selections. Run `apply --diff-file --selections-file`. Show result.

9. **Plugin instructions**: If any, show copy-paste commands.

10. **Cleanup**: Remove temp files.
