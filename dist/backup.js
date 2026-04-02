import { existsSync, mkdirSync, readdirSync, cpSync, rmSync, } from "node:fs";
import { join } from "node:path";
function backupsDir(claudeDir) {
    return join(claudeDir, "teleport-backups");
}
export async function createBackup(claudeDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupsDir(claudeDir), timestamp);
    mkdirSync(backupPath, { recursive: true });
    // Copy syncable directories and files
    const syncDirs = ["agents", "rules", "skills", "commands", "mcp-configs"];
    for (const dir of syncDirs) {
        const src = join(claudeDir, dir);
        if (existsSync(src)) {
            cpSync(src, join(backupPath, dir), { recursive: true });
        }
    }
    const syncFiles = ["settings.json", "CLAUDE.md", "AGENTS.md", "keybindings.json"];
    for (const file of syncFiles) {
        const src = join(claudeDir, file);
        if (existsSync(src)) {
            cpSync(src, join(backupPath, file));
        }
    }
    return { timestamp, claudeDir };
}
export function listBackups(claudeDir) {
    const dir = backupsDir(claudeDir);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ timestamp: d.name, claudeDir }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
export function cleanOldBackups(keep, claudeDir) {
    const backups = listBackups(claudeDir);
    if (backups.length <= keep)
        return [];
    const removed = [];
    // Always preserve the first-ever backup (index 0)
    const candidates = backups.slice(1, backups.length - keep + 1);
    for (const backup of candidates) {
        const path = join(backupsDir(claudeDir), backup.timestamp);
        rmSync(path, { recursive: true, force: true });
        removed.push(backup.timestamp);
    }
    return removed;
}
//# sourceMappingURL=backup.js.map