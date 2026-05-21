import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TELEPORT_VERSION, CATEGORY_PATHS, GLOBAL_DOC_FILES, STATUSLINE_SCRIPT_FILE, } from "./constants.js";
import { getMachineId } from "./machine.js";
import { hashContent, scanDirectoryToFileEntries } from "./utils.js";
import { substituteForExport } from "./paths.js";
import { redactCredentialsDeep } from "./secrets.js";
function scanSettings(baseDir, homeDir, claudeDir) {
    const settingsPath = join(baseDir, "settings.json");
    if (!existsSync(settingsPath))
        return {};
    try {
        const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
        // Drop credential-keyed values at any depth, then normalize absolute paths
        // in string values (e.g. statusLine.command) to portable placeholders.
        const filtered = redactCredentialsDeep(raw);
        return JSON.parse(substituteForExport(JSON.stringify(filtered), homeDir, claudeDir));
    }
    catch {
        return {};
    }
}
function scanPlugins(baseDir) {
    const filePath = join(baseDir, "plugins", "installed_plugins.json");
    if (!existsSync(filePath))
        return [];
    try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        // Read enabledPlugins from settings.json to set enabled flag
        const settingsPath = join(baseDir, "settings.json");
        const enabledPlugins = {};
        if (existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
                if (settings.enabledPlugins && typeof settings.enabledPlugins === "object") {
                    Object.assign(enabledPlugins, settings.enabledPlugins);
                }
            }
            catch { /* skip */ }
        }
        // v2 format: { version: 2, plugins: { "name@marketplace": [...installs] } }
        if (data && typeof data === "object" && data.version === 2 && data.plugins) {
            const entries = [];
            for (const [key, installs] of Object.entries(data.plugins)) {
                const atIdx = key.lastIndexOf("@");
                if (atIdx === -1)
                    continue;
                const name = key.slice(0, atIdx);
                const marketplace = key.slice(atIdx + 1);
                // Prefer user-scope install; fall back to first entry
                const allInstalls = installs;
                const install = allInstalls.find((i) => i["scope"] === "user") ?? allInstalls[0];
                if (!install)
                    continue;
                entries.push({
                    name,
                    marketplace,
                    version: install["version"],
                    scope: install["scope"],
                    enabled: enabledPlugins[key],
                    gitCommitSha: install["gitCommitSha"],
                });
            }
            return entries;
        }
        // v1 fallback: flat array
        if (Array.isArray(data)) {
            return data.map((p) => ({
                name: p.name ?? "",
                marketplace: p.marketplace ?? "",
                version: p.version,
                enabled: enabledPlugins[`${p.name}@${p.marketplace}`],
            }));
        }
        // Unknown format — warn so future format changes don't silently break
        console.warn(`[teleport] Unknown plugin format in ${filePath}, skipping`);
        return [];
    }
    catch {
        return [];
    }
}
function scanMarketplaces(baseDir) {
    const filePath = join(baseDir, "plugins", "known_marketplaces.json");
    const results = new Map();
    if (existsSync(filePath)) {
        try {
            const data = JSON.parse(readFileSync(filePath, "utf-8"));
            // v2 format: object keyed by marketplace name
            if (data && typeof data === "object" && !Array.isArray(data)) {
                for (const [name, entry] of Object.entries(data)) {
                    const src = entry["source"];
                    if (!src)
                        continue;
                    results.set(name, {
                        name,
                        source: {
                            source: src["source"] === "git" ? "git" : "github",
                            repo: src["repo"],
                            url: src["url"],
                        },
                    });
                }
            }
            else if (Array.isArray(data)) {
                // v1 fallback: flat array with {name, repo/repoUrl}
                for (const m of data) {
                    const name = m["name"] ?? "";
                    if (!name)
                        continue;
                    const repoUrl = m["repo"] ?? m["repoUrl"] ?? "";
                    results.set(name, {
                        name,
                        source: { source: "github", repo: repoUrl },
                    });
                }
            }
            else {
                console.warn(`[teleport] Unknown marketplace format in ${filePath}, skipping`);
            }
        }
        catch { /* skip */ }
    }
    // Merge extraKnownMarketplaces from settings.json (these are third-party marketplaces)
    const settingsPath = join(baseDir, "settings.json");
    if (existsSync(settingsPath)) {
        try {
            const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
            const extra = settings["extraKnownMarketplaces"];
            if (extra && typeof extra === "object") {
                for (const [name, entry] of Object.entries(extra)) {
                    if (results.has(name))
                        continue; // known_marketplaces.json takes precedence
                    const src = entry["source"];
                    if (!src)
                        continue;
                    results.set(name, {
                        name,
                        source: {
                            source: src["source"] === "git" ? "git" : "github",
                            repo: src["repo"],
                            url: src["url"],
                        },
                    });
                }
            }
        }
        catch { /* skip */ }
    }
    return Array.from(results.values());
}
function scanGlobalDocs(baseDir, homeDir, claudeDir) {
    const entries = [];
    for (const fileName of GLOBAL_DOC_FILES) {
        const filePath = join(baseDir, fileName);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
            const content = substituteForExport(readFileSync(filePath, "utf-8"), homeDir, claudeDir);
            entries.push({
                relativePath: fileName,
                contentHash: hashContent(content),
                content,
            });
        }
    }
    return entries;
}
function scanHooks(baseDir, homeDir, claudeDir) {
    // Canonical location is ~/.claude/hooks/hooks.json. Fall back to
    // ~/.claude/hooks.json (legacy) and ~/.claude/.cursor/hooks.json (Cursor).
    const candidatePaths = [
        join(baseDir, "hooks", "hooks.json"),
        join(baseDir, "hooks.json"),
        join(baseDir, ".cursor", "hooks.json"),
    ];
    const hooksJsonPath = candidatePaths.find((p) => existsSync(p));
    if (!hooksJsonPath)
        return [];
    try {
        const data = JSON.parse(readFileSync(hooksJsonPath, "utf-8"));
        if (!Array.isArray(data))
            return [];
        return data.map((h) => {
            const config = h.config
                ? JSON.parse(substituteForExport(JSON.stringify(h.config), homeDir, claudeDir))
                : undefined;
            return {
                name: String(h.name ?? ""),
                event: String(h.event ?? ""),
                command: substituteForExport(String(h.command ?? ""), homeDir, claudeDir),
                config,
            };
        });
    }
    catch {
        return [];
    }
}
function scanKeybindings(baseDir, homeDir, claudeDir) {
    const filePath = join(baseDir, "keybindings.json");
    if (!existsSync(filePath))
        return undefined;
    try {
        const content = substituteForExport(readFileSync(filePath, "utf-8"), homeDir, claudeDir);
        return { relativePath: "keybindings.json", contentHash: hashContent(content), content };
    }
    catch {
        return undefined;
    }
}
function scanStatuslineScript(baseDir, homeDir, claudeDir) {
    const filePath = join(baseDir, STATUSLINE_SCRIPT_FILE);
    if (!existsSync(filePath) || !statSync(filePath).isFile())
        return undefined;
    try {
        const content = substituteForExport(readFileSync(filePath, "utf-8"), homeDir, claudeDir);
        return {
            relativePath: STATUSLINE_SCRIPT_FILE,
            contentHash: hashContent(content),
            content,
        };
    }
    catch {
        return undefined;
    }
}
export async function scanClaudeDir(claudeDir) {
    const machine = getMachineId();
    const homeDir = homedir();
    return {
        teleportVersion: TELEPORT_VERSION,
        machineId: machine.id,
        machineAlias: machine.alias,
        plugins: scanPlugins(claudeDir),
        marketplaces: scanMarketplaces(claudeDir),
        agents: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.agents, "agents", homeDir, claudeDir),
        rules: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.rules, "rules", homeDir, claudeDir),
        skills: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.skills, "skills", homeDir, claudeDir),
        commands: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.commands, "commands", homeDir, claudeDir),
        settings: scanSettings(claudeDir, homeDir, claudeDir),
        globalDocs: scanGlobalDocs(claudeDir, homeDir, claudeDir),
        hooks: scanHooks(claudeDir, homeDir, claudeDir),
        mcp: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.mcp, "mcp", homeDir, claudeDir),
        scripts: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.scripts, "scripts", homeDir, claudeDir),
        keybindings: scanKeybindings(claudeDir, homeDir, claudeDir),
        statuslineScript: scanStatuslineScript(claudeDir, homeDir, claudeDir),
    };
}
//# sourceMappingURL=scanner.js.map