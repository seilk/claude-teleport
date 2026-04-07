---
name: teleport-update
description: "Update already-pushed private/public repos with local changes that haven't been synced yet"
allowed-tools: [Bash, Read, Write, AskUserQuestion]
---

# Teleport Update

Detect and push local changes that haven't been synced to your already-pushed `claude-teleport-private` or `claude-teleport-public` repos.

Unlike `/teleport-push` (full push to private) or `/teleport-share` (curate for public), this command focuses on **incremental updates** — finding only what changed locally since the last push and selectively syncing it to one or both repos.

## Steps

1. **Hub-connect preamble**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" context`. Parse JSON.
   - If `auth.ghInstalled` is false or `auth.authenticated` is false: show instructions. STOP.
   - Store `auth.username` and `machine.alias`.

2. **Clone/pull private hub**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-init --clone-to /tmp/teleport-hub-update`. Store `localPath` as `hubPath`.

3. **Check public repo**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-check-public --username <username>`. Parse JSON.
   - If `exists` is true: clone/pull public repo to `/tmp/teleport-public-update` via `gh repo clone <username>/claude-teleport-public /tmp/teleport-public-update` (or `git pull --rebase` if already cloned). Store path as `pubHubPath`.
   - If `exists` is false: store `pubHubPath` as null. Note: "No public repo found. Only private hub will be checked."

4. **Scan local**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" scan --output /tmp/teleport-update-local.json`.

5. **Diff against private hub**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-read-branch --hub-path <hubPath> --branch <machineAlias> --output /tmp/hub-private-snap.json`.
   - If branch not found, try: `hub-read-main --hub-path <hubPath> --machine <machineAlias> --output /tmp/hub-private-snap.json`.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" diff --source-file /tmp/teleport-update-local.json --target-file /tmp/hub-private-snap.json --output /tmp/diff-private.json`.

6. **Diff against public repo** (if `pubHubPath` exists): Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-read-public --hub-path <pubHubPath> --machine <machineAlias> --output /tmp/hub-public-snap.json`.
   - If machine not found in public repo: note "This machine has no configs in the public repo yet."
   - Otherwise: `diff --source-file /tmp/teleport-update-local.json --target-file /tmp/hub-public-snap.json --output /tmp/diff-public.json`.

7. **Check empty**: Read both diff files. If both have no added/modified items: "Everything is up to date. No local changes to push." STOP.

8. **Present changes summary**: Show a clear summary for each target:
   ```
   Private hub (claude-teleport-private):
     +3 agents, ~2 rules, +1 skill (not yet pushed)

   Public repo (claude-teleport-public):
     +5 agents, ~1 settings (not yet published)
   ```
   Only show targets that have changes. Use `added` count for `+N` and `modified` count for `~N`.

9. **Select target**: Use `AskUserQuestion` (single-select). Options depend on what has changes:
   - If both have changes: "Private hub only", "Public repo only", "Both"
   - If only private has changes: skip this question, proceed with private.
   - If only public has changes: skip this question, proceed with public.

10. **Category & item selection** (per selected target):
    - For each target, read its diff file.
    - Use `AskUserQuestion` with `multiSelect: true` to present categories with counts (e.g., "agents (+3)", "rules (~2)"). Only show categories that have changes.
    - For each selected category with many items, use another `AskUserQuestion` with `multiSelect: true` listing individual items with their status (added/modified).

11. **Secret scan**: Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" secret-scan --snapshot-file /tmp/teleport-update-local.json --output /tmp/teleport-update-secrets.json`. If findings: show each finding. Auto-exclude flagged items from the push.

12. **RCE scan** (public target only): For each selected hook, agent, or CLAUDE.md going to the public repo, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" rce-scan --file <path>`. If findings: show flagged lines. Require explicit "yes" to include.

13. **Push to private hub** (if selected): Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-push --hub-path <hubPath> --machine <machineAlias> --username <username> --snapshot-file /tmp/teleport-update-local.json`. Show result.

14. **Push to public repo** (if selected): Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" hub-push-public --hub-path <pubHubPath> --machine <machineAlias> --username <username> --snapshot-file /tmp/teleport-update-local.json`. Show result.

15. **Success**: Show summary per target:
    ```
    ✓ Private hub updated: +3 agents, ~2 rules pushed to branch '<machineAlias>'
    ✓ Public repo updated: +5 agents published
    ```

16. **Cleanup**: Remove temp files (`/tmp/teleport-update-*`, `/tmp/hub-private-snap.json`, `/tmp/hub-public-snap.json`, `/tmp/diff-private.json`, `/tmp/diff-public.json`, `/tmp/teleport-hub-update`, `/tmp/teleport-public-update`).
