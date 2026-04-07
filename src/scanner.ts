import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  TELEPORT_VERSION,
  CATEGORY_PATHS,
  GLOBAL_DOC_FILES,
  CREDENTIAL_KEYS,
} from "./constants.js";
import { getMachineId } from "./machine.js";
import type { Snapshot, FileEntry, PluginEntry, Marketplace, HookEntry } from "./types.js";
import { hashContent, scanDirectoryToFileEntries } from "./utils.js";

function scanSettings(baseDir: string): Record<string, unknown> {
  const settingsPath = join(baseDir, "settings.json");
  if (!existsSync(settingsPath)) return {};

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const isCredential = CREDENTIAL_KEYS.some((ck) =>
        key.toLowerCase().includes(ck.toLowerCase()),
      );
      if (!isCredential) {
        filtered[key] = value;
      }
    }
    return filtered;
  } catch {
    return {};
  }
}

function scanPlugins(baseDir: string): PluginEntry[] {
  const filePath = join(baseDir, "plugins", "installed_plugins.json");
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));

    // Read enabledPlugins from settings.json to set enabled flag
    const settingsPath = join(baseDir, "settings.json");
    const enabledPlugins: Record<string, boolean> = {};
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        if (settings.enabledPlugins && typeof settings.enabledPlugins === "object") {
          Object.assign(enabledPlugins, settings.enabledPlugins);
        }
      } catch { /* skip */ }
    }

    // v2 format: { version: 2, plugins: { "name@marketplace": [...installs] } }
    if (data && typeof data === "object" && data.version === 2 && data.plugins) {
      const entries: PluginEntry[] = [];
      for (const [key, installs] of Object.entries(data.plugins as Record<string, unknown[]>)) {
        const atIdx = key.lastIndexOf("@");
        if (atIdx === -1) continue;
        const name = key.slice(0, atIdx);
        const marketplace = key.slice(atIdx + 1);
        // Prefer user-scope install; fall back to first entry
        const allInstalls = installs as Array<Record<string, unknown>>;
        const install = allInstalls.find((i) => i["scope"] === "user") ?? allInstalls[0];
        if (!install) continue;
        entries.push({
          name,
          marketplace,
          version: install["version"] as string | undefined,
          scope: install["scope"] as "user" | "project" | undefined,
          enabled: enabledPlugins[key],
          gitCommitSha: install["gitCommitSha"] as string | undefined,
        });
      }
      return entries;
    }

    // v1 fallback: flat array
    if (Array.isArray(data)) {
      return data.map((p: Record<string, string>) => ({
        name: p.name ?? "",
        marketplace: p.marketplace ?? "",
        version: p.version,
        enabled: enabledPlugins[`${p.name}@${p.marketplace}`],
      }));
    }

    // Unknown format — warn so future format changes don't silently break
    console.warn(`[teleport] Unknown plugin format in ${filePath}, skipping`);
    return [];
  } catch {
    return [];
  }
}

function scanMarketplaces(baseDir: string): Marketplace[] {
  const filePath = join(baseDir, "plugins", "known_marketplaces.json");

  const results = new Map<string, Marketplace>();

  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));

      // v2 format: object keyed by marketplace name
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [name, entry] of Object.entries(data as Record<string, Record<string, unknown>>)) {
          const src = entry["source"] as Record<string, string> | undefined;
          if (!src) continue;
          results.set(name, {
            name,
            source: {
              source: src["source"] === "git" ? "git" : "github",
              repo: src["repo"],
              url: src["url"],
            },
          });
        }
      } else if (Array.isArray(data)) {
        // v1 fallback: flat array with {name, repo/repoUrl}
        for (const m of data as Array<Record<string, string>>) {
          const name = m["name"] ?? "";
          if (!name) continue;
          const repoUrl = m["repo"] ?? m["repoUrl"] ?? "";
          results.set(name, {
            name,
            source: { source: "github", repo: repoUrl },
          });
        }
      } else {
        console.warn(`[teleport] Unknown marketplace format in ${filePath}, skipping`);
      }
    } catch { /* skip */ }
  }

  // Merge extraKnownMarketplaces from settings.json (these are third-party marketplaces)
  const settingsPath = join(baseDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const extra = settings["extraKnownMarketplaces"] as Record<string, Record<string, unknown>> | undefined;
      if (extra && typeof extra === "object") {
        for (const [name, entry] of Object.entries(extra)) {
          if (results.has(name)) continue; // known_marketplaces.json takes precedence
          const src = entry["source"] as Record<string, string> | undefined;
          if (!src) continue;
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
    } catch { /* skip */ }
  }

  return Array.from(results.values());
}

function scanGlobalDocs(baseDir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const fileName of GLOBAL_DOC_FILES) {
    const filePath = join(baseDir, fileName);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const content = readFileSync(filePath, "utf-8");
      entries.push({
        relativePath: fileName,
        contentHash: hashContent(content),
        content,
      });
    }
  }
  return entries;
}

function scanHooks(baseDir: string): HookEntry[] {
  // Check hooks.json in claude dir, with .cursor/hooks.json as fallback
  let hooksJsonPath = join(baseDir, "hooks.json");
  if (!existsSync(hooksJsonPath)) {
    hooksJsonPath = join(baseDir, ".cursor", "hooks.json");
  }
  if (!existsSync(hooksJsonPath)) return [];
  try {
    const data = JSON.parse(readFileSync(hooksJsonPath, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data.map((h: Record<string, unknown>) => ({
      name: String(h.name ?? ""),
      event: String(h.event ?? ""),
      command: String(h.command ?? ""),
      config: (h.config as Record<string, unknown>) ?? undefined,
    }));
  } catch {
    return [];
  }
}

function scanKeybindings(baseDir: string): FileEntry | undefined {
  const filePath = join(baseDir, "keybindings.json");
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, "utf-8");
    return { relativePath: "keybindings.json", contentHash: hashContent(content), content };
  } catch {
    return undefined;
  }
}

export async function scanClaudeDir(claudeDir: string): Promise<Snapshot> {
  const machine = getMachineId();

  return {
    teleportVersion: TELEPORT_VERSION,
    machineId: machine.id,
    machineAlias: machine.alias,
    plugins: scanPlugins(claudeDir),
    marketplaces: scanMarketplaces(claudeDir),
    agents: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.agents, "agents"),
    rules: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.rules, "rules"),
    skills: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.skills, "skills"),
    commands: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.commands, "commands"),
    settings: scanSettings(claudeDir),
    globalDocs: scanGlobalDocs(claudeDir),
    hooks: scanHooks(claudeDir),
    mcp: scanDirectoryToFileEntries(claudeDir, CATEGORY_PATHS.mcp, "mcp"),
    keybindings: scanKeybindings(claudeDir),
  };
}
