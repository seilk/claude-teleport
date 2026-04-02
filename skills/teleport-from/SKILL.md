---
name: teleport-from
description: "Import configs from another user's public teleport repo"
allowed-tools: [Bash, Read, Write, AskUserQuestion]
argument-hint: "<github-username>"
---

# Teleport From

Import configurations from another user's public teleport repo.

## Steps

1. **Clone public repo**: Clone `<username>/claude-teleport-public` to a temp directory. The repo contains an agent-friendly `README.md` that describes the repository structure and import instructions.

2. **List machines**: Read `registry.yaml` from the cloned repo to list available machines and their config counts. Use `AskUserQuestion` (single-select) to let the user pick a machine. Options: each machine name with config counts as description (e.g. "macbook-pro (3 agents, 5 rules)"), plus "main (merged union of all machines)".

3. **Read machine configs**: Read files from `machines/<selected-alias>/` in the repo. Present categories: "Available: X agents, Y rules, Z skills." File paths inside `machines/<alias>/` map directly to `~/.claude/` paths.

4. **User selects**: Use `AskUserQuestion` with `multiSelect: true` to present available categories. Then for each selected category, use another `AskUserQuestion` with `multiSelect: true` listing specific items.

5. **Mandatory content review**: For ALL selected files (not just hooks):
   - Run `rce-scan --file <path>` on each.
   - Show full file content to the user.
   - If RCE patterns found: highlight flagged lines.
   - User must explicitly approve each file: "I've reviewed this, apply it."

6. **Backup**: Run `backup --claude-dir ~/.claude`. Show backup path.

7. **Apply**: Apply selected items using the `apply` command.

8. **Show result**: Display what was applied, any errors, and plugin install instructions.

9. **Cleanup**: Remove temp directory.
