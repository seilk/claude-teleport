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
function updateSettings(claudeDir, updater) {
    const settingsPath = join(claudeDir, "settings.json");
    const existing = existsSync(settingsPath)
        ? JSON.parse(readFileSync(settingsPath, "utf-8"))
        : {};
    updater(existing);
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
}
function applyPluginEntry(entry, claudeDir, instructions) {
    let plugin;
    try {
        plugin = entry.sourceContent ? JSON.parse(entry.sourceContent) : undefined;
    }
    catch { /* invalid JSON, proceed without */ }
    if (!plugin) {
        instructions.push(`Install plugin: ${entry.relativePath}`);
        return { path: entry.relativePath, status: "ok" };
    }
    const key = `${plugin.name}@${plugin.marketplace}`;
    if (entry.type === "modified") {
        const target = entry.targetContent
            ? JSON.parse(entry.targetContent)
            : undefined;
        const versionChanged = !target || plugin.version !== target.version;
        const enabledChanged = target && plugin.enabled !== target.enabled;
        if (versionChanged) {
            instructions.push(`Run: claude plugins update ${plugin.name}`);
        }
        if (enabledChanged && plugin.enabled !== undefined) {
            // Write enabled state directly to settings.json
            updateSettings(claudeDir, (s) => {
                if (!s["enabledPlugins"] || typeof s["enabledPlugins"] !== "object") {
                    s["enabledPlugins"] = {};
                }
                s["enabledPlugins"][key] = plugin.enabled;
            });
        }
    }
    else {
        // added
        instructions.push(`Run: claude plugins install ${plugin.name} from ${plugin.marketplace}`);
        if (plugin.enabled !== undefined) {
            updateSettings(claudeDir, (s) => {
                if (!s["enabledPlugins"] || typeof s["enabledPlugins"] !== "object") {
                    s["enabledPlugins"] = {};
                }
                s["enabledPlugins"][key] = plugin.enabled;
            });
        }
    }
    return { path: entry.relativePath, status: "ok" };
}
function applyMarketplaceEntry(entry, claudeDir, instructions) {
    let marketplace;
    try {
        marketplace = entry.sourceContent ? JSON.parse(entry.sourceContent) : undefined;
    }
    catch { /* invalid JSON */ }
    if (!marketplace) {
        instructions.push(`Register marketplace: ${entry.relativePath}`);
        return { path: entry.relativePath, status: "ok" };
    }
    const src = marketplace.source;
    if (src.source === "github" && src.repo) {
        instructions.push(`Run: claude plugins marketplace add ${src.repo}`);
    }
    else if (src.source === "git" && src.url) {
        instructions.push(`Run: claude plugins marketplace add ${src.url}`);
    }
    else {
        instructions.push(`Register marketplace: ${marketplace.name}`);
    }
    // Also add to extraKnownMarketplaces in settings.json so Claude Code can find it
    updateSettings(claudeDir, (s) => {
        if (!s["extraKnownMarketplaces"] || typeof s["extraKnownMarketplaces"] !== "object") {
            s["extraKnownMarketplaces"] = {};
        }
        const extra = s["extraKnownMarketplaces"];
        if (!extra[marketplace.name]) {
            extra[marketplace.name] = { source: marketplace.source };
        }
    });
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
                applied.push(applyPluginEntry(entry, claudeDir, pluginInstructions));
            }
            else if (entry.category === "marketplaces") {
                applied.push(applyMarketplaceEntry(entry, claudeDir, marketplaceInstructions));
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