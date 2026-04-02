---
name: teleport-share
description: "Publish safe configs to a public repo for other users to import"
allowed-tools: [Bash, Read, Write]
---

# Teleport Share

Publish a curated, safe subset of your configs to `claude-teleport-public` repo.

## Steps

1. **Hub-connect preamble**: Run `context`. Verify auth. Clone/pull `claude-teleport-private`. Store `hubPath`.

2. **Gather items**: Run `hub-machines --hub-path <hubPath>` to list branches. For each machine branch, checkout and read configs. Build deduplicated union (latest-pushed wins on collision).

3. **Present available**: Show by category.

4. **User selects**: "Which categories to share publicly?" Then: "Which specific items?"

5. **Double secret scan**: Run `secret-scan` on selected items. If findings: show and auto-exclude.

6. **RCE scan**: Run `rce-scan` on each selected agent/hook/CLAUDE.md. If findings: show flagged lines. Require explicit yes.

7. **Item-by-item confirmation**: Show first 10 lines of each file. "Include in public repo?"

8. **Create/update public repo**: Check if `<username>/claude-teleport-public` exists. If not, create it. Clone to temp. Push selected items under `machines/<source-alias>/` (namespaced per machine). Generate `registry.yaml` and an agent-friendly `README.md` (with import instructions for `/teleport-from`). Merge into main.

9. **Push**: Commit and push.

10. **Success**: "Published N items to `<username>/claude-teleport-public`. Others can `/teleport-from <username>` to browse and import."
