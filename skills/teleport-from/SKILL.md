---
name: teleport-from
description: "Import configs from another user's public teleport repo"
allowed-tools: [Bash, Read, Write]
argument-hint: "<github-username>"
---

# Teleport From

Import configurations from another user's public teleport repo.

## Steps

1. **Clone public repo**: Clone `<username>/claude-teleport-public` to a temp directory.

2. **List branches**: `git branch -r` to show available machines. Present: "Available machines from <username>: macbook-pro, work-imac". User picks a branch (or `main` for union).

3. **Checkout and scan**: `git checkout <branch>`. Read the contents and present categories: "Available: X agents, Y rules, Z skills."

4. **User selects**: "Which categories to import?" Then: "Which specific items?"

5. **Mandatory content review**: For ALL selected files (not just hooks):
   - Run `rce-scan --file <path>` on each.
   - Show full file content to the user.
   - If RCE patterns found: highlight flagged lines.
   - User must explicitly approve each file: "I've reviewed this, apply it."

6. **Backup**: Run `backup --claude-dir ~/.claude`. Show backup path.

7. **Apply**: Apply selected items using the `apply` command.

8. **Show result**: Display what was applied, any errors, and plugin install instructions.

9. **Cleanup**: Remove temp directory.
