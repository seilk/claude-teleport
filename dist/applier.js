import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
function ensureDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function applyFileEntry(entry, claudeDir) {
    if (!entry.sourceContent) {
        return { path: entry.relativePath, status: "error", error: "No source content" };
    }
    const targetPath = join(claudeDir, entry.relativePath);
    ensureDir(targetPath);
    writeFileSync(targetPath, entry.sourceContent);
    return { path: entry.relativePath, status: "ok" };
}
function applySettingsEntry(entry, claudeDir) {
    const settingsPath = join(claudeDir, "settings.json");
    const existing = existsSync(settingsPath)
        ? JSON.parse(readFileSync(settingsPath, "utf-8"))
        : {};
    // Extract key name from "settings/keyName"
    const key = entry.relativePath.replace("settings/", "");
    try {
        existing[key] = JSON.parse(entry.sourceContent ?? "null");
    }
    catch {
        existing[key] = entry.sourceContent;
    }
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    return { path: entry.relativePath, status: "ok" };
}
export async function applyDiff(selections, claudeDir) {
    const applied = [];
    const pluginInstructions = [];
    const marketplaceInstructions = [];
    for (const entry of selections) {
        try {
            if (entry.category === "settings") {
                applied.push(applySettingsEntry(entry, claudeDir));
            }
            else if (entry.category === "plugins") {
                // Extract plugin name from "plugins/marketplace/name"
                const parts = entry.relativePath.split("/");
                const pluginName = parts[parts.length - 1];
                pluginInstructions.push(`Install plugin: ${pluginName}`);
                applied.push({ path: entry.relativePath, status: "ok" });
            }
            else if (entry.category === "marketplaces") {
                const parts = entry.relativePath.split("/");
                const name = parts[parts.length - 1];
                marketplaceInstructions.push(`Register marketplace: ${name}`);
                applied.push({ path: entry.relativePath, status: "ok" });
            }
            else {
                // File-based categories: agents, rules, skills, commands, globalDocs, mcp
                applied.push(applyFileEntry(entry, claudeDir));
            }
        }
        catch (err) {
            applied.push({
                path: entry.relativePath,
                status: "error",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { applied, pluginInstructions, marketplaceInstructions };
}
//# sourceMappingURL=applier.js.map