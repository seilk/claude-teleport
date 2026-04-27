import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import type { DiffEntry, ApplyResult, ApplyItemResult, PluginEntry, Marketplace } from "./types.js";

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isExecutableScript(content: string): boolean {
  // A shebang on the first line indicates an executable script (.sh, .py, .js, etc.).
  return content.startsWith("#!");
}

function applyFileEntry(entry: DiffEntry, claudeDir: string): ApplyItemResult {
  if (!entry.sourceContent) {
    return { path: entry.relativePath, status: "error", error: "No source content" };
  }
  const targetPath = join(claudeDir, entry.relativePath);
  ensureDir(targetPath);
  writeFileSync(targetPath, entry.sourceContent);
  // Restore the executable bit for scripts so synced hooks run on the target machine.
  if (isExecutableScript(entry.sourceContent)) {
    try {
      chmodSync(targetPath, 0o755);
    } catch {
      // Permission errors should not abort the apply; the file is already written.
    }
  }
  return { path: entry.relativePath, status: "ok" };
}

function applySettingsEntry(entry: DiffEntry, claudeDir: string): ApplyItemResult {
  const settingsPath = join(claudeDir, "settings.json");
  const existing = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : {};

  const key = entry.relativePath.replace("settings/", "");

  if (entry.type === "removed") {
    delete existing[key];
  } else {
    try {
      existing[key] = JSON.parse(entry.sourceContent ?? "null");
    } catch {
      existing[key] = entry.sourceContent;
    }
  }

  writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
  return { path: entry.relativePath, status: "ok" };
}

function updateSettings(claudeDir: string, updater: (settings: Record<string, unknown>) => void): void {
  const settingsPath = join(claudeDir, "settings.json");
  const existing = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : {};
  updater(existing);
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
}

function applyPluginEntry(
  entry: DiffEntry,
  claudeDir: string,
  instructions: string[],
): ApplyItemResult {
  let plugin: PluginEntry | undefined;
  try {
    plugin = entry.sourceContent ? JSON.parse(entry.sourceContent) as PluginEntry : undefined;
  } catch { /* invalid JSON, proceed without */ }

  if (!plugin) {
    instructions.push(`Install plugin: ${entry.relativePath}`);
    return { path: entry.relativePath, status: "ok" };
  }

  const key = `${plugin.name}@${plugin.marketplace}`;

  if (entry.type === "modified") {
    const target: PluginEntry | undefined = entry.targetContent
      ? JSON.parse(entry.targetContent) as PluginEntry
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
        (s["enabledPlugins"] as Record<string, boolean>)[key] = plugin!.enabled!;
      });
    }
  } else {
    // added
    instructions.push(`Run: claude plugins install ${plugin.name} from ${plugin.marketplace}`);
    if (plugin.enabled !== undefined) {
      updateSettings(claudeDir, (s) => {
        if (!s["enabledPlugins"] || typeof s["enabledPlugins"] !== "object") {
          s["enabledPlugins"] = {};
        }
        (s["enabledPlugins"] as Record<string, boolean>)[key] = plugin!.enabled!;
      });
    }
  }

  return { path: entry.relativePath, status: "ok" };
}

function applyMarketplaceEntry(
  entry: DiffEntry,
  claudeDir: string,
  instructions: string[],
): ApplyItemResult {
  let marketplace: Marketplace | undefined;
  try {
    marketplace = entry.sourceContent ? JSON.parse(entry.sourceContent) as Marketplace : undefined;
  } catch { /* invalid JSON */ }

  if (!marketplace) {
    instructions.push(`Register marketplace: ${entry.relativePath}`);
    return { path: entry.relativePath, status: "ok" };
  }

  const src = marketplace.source;
  if (src.source === "github" && src.repo) {
    instructions.push(`Run: claude plugins marketplace add ${src.repo}`);
  } else if (src.source === "git" && src.url) {
    instructions.push(`Run: claude plugins marketplace add ${src.url}`);
  } else {
    instructions.push(`Register marketplace: ${marketplace.name}`);
  }

  // Also add to extraKnownMarketplaces in settings.json so Claude Code can find it
  updateSettings(claudeDir, (s) => {
    if (!s["extraKnownMarketplaces"] || typeof s["extraKnownMarketplaces"] !== "object") {
      s["extraKnownMarketplaces"] = {};
    }
    const extra = s["extraKnownMarketplaces"] as Record<string, unknown>;
    if (!extra[marketplace!.name]) {
      extra[marketplace!.name] = { source: marketplace!.source };
    }
  });

  return { path: entry.relativePath, status: "ok" };
}

export async function applyDiff(
  selections: readonly DiffEntry[],
  claudeDir: string,
): Promise<ApplyResult> {
  const applied: ApplyItemResult[] = [];
  const pluginInstructions: string[] = [];
  const marketplaceInstructions: string[] = [];

  for (const entry of selections) {
    try {
      if (entry.category === "settings") {
        applied.push(applySettingsEntry(entry, claudeDir));
      } else if (entry.category === "plugins") {
        applied.push(applyPluginEntry(entry, claudeDir, pluginInstructions));
      } else if (entry.category === "marketplaces") {
        applied.push(applyMarketplaceEntry(entry, claudeDir, marketplaceInstructions));
      } else {
        // File-based categories: agents, rules, skills, commands, globalDocs, mcp
        applied.push(applyFileEntry(entry, claudeDir));
      }
    } catch (err) {
      applied.push({
        path: entry.relativePath,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { applied, pluginInstructions, marketplaceInstructions };
}
