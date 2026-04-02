---
name: teleport-push
description: "Push local Claude Code changes to your hub"
allowed-tools: [Bash, Read, Write, AskUserQuestion]
---

# Teleport Push

Upload your local Claude Code changes to your private hub. Creates/updates a branch named after this machine, then merges into main.

## Steps

1. **Hub-connect preamble**: Run `context`. Verify auth. Store `username`, `machineAlias`. Clone/pull `claude-teleport-private` to `/tmp/teleport-hub-<random>`. Store as `hubPath`.

2. **Scan local**: Run `scan --output /tmp/teleport-local.json`.

3. **Diff to hub**: Run `hub-read-branch --hub-path <hubPath> --branch <machineAlias> --output /tmp/hub-snap.json` (may return null if first push). Run `diff --source-file /tmp/teleport-local.json --target-file /tmp/hub-snap.json --output /tmp/diff.json`.

4. **Check empty**: If diff has no added/modified items: "Hub is up to date." STOP.

5. **Present changes**: Show summary by category. Use `AskUserQuestion` with `multiSelect: true` to let the user select which categories to push. For categories with many items, use another `AskUserQuestion` with `multiSelect: true` for item-level selection.

6. **Secret scan**: Run `secret-scan` on local snapshot. If findings: show, auto-exclude.

7. **First-push gate**: If this machine's branch doesn't exist yet: "First push from this machine. Review file list." Confirm.

8. **Push**: Run `hub-push --hub-path <hubPath> --machine <machineAlias> --snapshot-file /tmp/teleport-local.json`. This creates/updates the machine branch and merges into main.

9. **Success**: "Pushed N items to branch `<machineAlias>`. Other machines can `/teleport-pull` to pick them up."

10. **Cleanup**: Remove temp files.
