---
name: teleport-init
description: "First-time setup: create private hub repo, scan and export your Claude Code environment"
allowed-tools: [Bash, Read, Write, AskUserQuestion]
argument-hint: "[machine-alias]"
---

# Teleport Init

Set up Teleport for the first time on this machine.

## Steps

1. **Check prerequisites**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" context`. Parse the JSON result.
   - If `auth.ghInstalled` is false: show install command based on `auth.os` (darwin: `brew install gh`, linux: `sudo apt install gh`). STOP.
   - If `auth.authenticated` is false: show `gh auth login` instructions. STOP.
   - Store `auth.username` and `machine.alias`.

2. **Confirm machine name**: Show the detected `machine.alias` to the user. Ask if they want to keep it or rename. If an argument was provided, use that instead.

3. **Create hub repo**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-init --clone-to /tmp/claude-teleport-hub`. Parse result.
   - If `created` is false: inform user "Hub already exists at <repoUrl>. Using existing."
   - If `created` is true: inform user "Created private hub at <repoUrl>."
   - Store `username` and `localPath` from the result for later use.

4. **Scan local environment**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" scan --claude-dir ~/.claude --output /tmp/teleport-scan.json`. Parse the JSON output — it contains a `summary` object with counts per category.

5. **Present summary**: Using the `summary` from the scan output, present:
   ```
   Found on this machine:
   - Plugins: {summary.plugins}
   - Agents: {summary.agents}
   - Rules: {summary.rules}
   - Skills: {summary.skills}
   - Hooks: {summary.hooks}
   - Settings keys: {summary.settings}
   - MCP configs: {summary.mcp}
   ```

6. **Category selection**: Use `AskUserQuestion` with `multiSelect: true` to present categories (Plugins, Agents, Rules, Skills, Hooks, Settings — only show categories with items). Then for each selected category, use another `AskUserQuestion` with `multiSelect: true` listing the individual items, asking "Any items to exclude?"

   **Important**: In the snapshot JSON, most categories (`agents`, `rules`, `skills`, `commands`, `mcp`) are arrays of `FileEntry` objects with a `relativePath` field. However, `settings` is a plain object (key-value pairs, not an array) — use `Object.keys()` to list its items. `plugins` and `marketplaces` are arrays of objects with a `name` field. `hooks` is an array of objects with `name` and `event` fields.

7. **Secret scan**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" secret-scan --snapshot-file /tmp/teleport-scan.json --output /tmp/teleport-secrets.json`. Read findings. If any: show each finding with file and line. Confirm exclusion.

8. **First-push review gate**: "This is the first push. Please review the files that will be committed:" Show the file list. Wait for user confirmation.

9. **Push to hub**: Write selections to `/tmp/teleport-selections.json`. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-push --hub-path <localPath> --machine <alias> --username <username> --snapshot-file /tmp/teleport-scan.json --selections-file /tmp/teleport-selections.json`. This writes configs under `machines/<alias>/` in the hub, generates `registry.yaml` on main, and creates an agent-friendly `README.md`.

10. **Success**: Show "Your Claude Code setup has been teleported to <repoUrl>. Run `/teleport-pull` on other machines to apply."

11. **Cleanup**: Remove temp files.
