import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import {
  TELEPORT_VERSION,
  CATEGORY_PATHS,
  GLOBAL_DOC_FILES,
  CREDENTIAL_KEYS,
} from "./constants.js";
import { getMachineId } from "./machine.js";
import type { Snapshot, FileEntry, PluginEntry, Marketplace, HookEntry } from "./types.js";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isTextFile(filePath: string): boolean {
  try {
    const buf = readFileSync(filePath);
    // Check for null bytes as a simple binary detection
    for (let i = 0; i < Math.min(buf.length, 8000); i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function scanDirectory(baseDir: string, dirPath: string, category: string): FileEntry[] {
  const fullPath = join(baseDir, dirPath);
  if (!existsSync(fullPath)) return [];

  const entries: FileEntry[] = [];

  function walk(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const itemPath = join(dir, item.name);
      if (item.isDirectory()) {
        walk(itemPath);
      } else if (item.isFile() && isTextFile(itemPath)) {
        const content = readFileSync(itemPath, "utf-8");
        entries.push({
          relativePath: join(category, relative(fullPath, itemPath)),
          contentHash: hashContent(content),
          content,
        });
      }
    }
  }

  walk(fullPath);
  return entries;
}

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
    return (Array.isArray(data) ? data : []).map((p: Record<string, string>) => ({
      name: p.name ?? "",
      marketplace: p.marketplace ?? "",
      version: p.version,
    }));
  } catch {
    return [];
  }
}

function scanMarketplaces(baseDir: string): Marketplace[] {
  const filePath = join(baseDir, "plugins", "known_marketplaces.json");
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return (Array.isArray(data) ? data : []).map((m: Record<string, string>) => ({
      name: m.name ?? "",
      repoUrl: m.repo ?? m.repoUrl ?? "",
    }));
  } catch {
    return [];
  }
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
  // Check .cursor/hooks.json pattern
  const hooksJsonPath = join(baseDir, ".cursor", "hooks.json");
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
    agents: scanDirectory(claudeDir, CATEGORY_PATHS.agents, "agents"),
    rules: scanDirectory(claudeDir, CATEGORY_PATHS.rules, "rules"),
    skills: scanDirectory(claudeDir, CATEGORY_PATHS.skills, "skills"),
    commands: scanDirectory(claudeDir, CATEGORY_PATHS.commands, "commands"),
    settings: scanSettings(claudeDir),
    globalDocs: scanGlobalDocs(claudeDir),
    hooks: scanHooks(claudeDir),
    mcp: scanDirectory(claudeDir, CATEGORY_PATHS.mcp, "mcp"),
    keybindings: scanKeybindings(claudeDir),
  };
}
