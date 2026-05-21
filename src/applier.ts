import { readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { DiffEntry, ApplyResult, ApplyItemResult, PluginEntry, Marketplace } from "./types.js";
import { substituteForImport } from "./paths.js";
import { safeWriteTarget, isForbiddenSettingsKey, atomicWrite } from "./safe-path.js";

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

function applyFileEntry(
  entry: DiffEntry,
  claudeDir: string,
  homeDir: string,
): ApplyItemResult {
  if (!entry.sourceContent) {
    return { path: entry.relativePath, status: "error", error: "No source content" };
  }
  // Reject anything that would write outside the config dir or through a
  // symlink — relativePath may come from another user's repo via teleport-from.
  const target = safeWriteTarget(claudeDir, entry.relativePath);
  if (!target.ok) {
    return { path: entry.relativePath, status: "error", error: target.reason };
  }
  const targetPath = target.path;
  // Expand portable placeholders to this machine's real paths.
  const content = substituteForImport(entry.sourceContent, homeDir, claudeDir);
  ensureDir(targetPath);
  atomicWrite(targetPath, content);
  // Restore the executable bit for scripts so synced hooks run on the target machine.
  if (isExecutableScript(content)) {
    try {
      chmodSync(targetPath, 0o755);
    } catch {
      // Permission errors should not abort the apply; the file is already written.
    }
  }
  return { path: entry.relativePath, status: "ok" };
}

function applySettingsEntry(
  entry: DiffEntry,
  claudeDir: string,
  homeDir: string,
): ApplyItemResult {
  const key = entry.relativePath.replace(/^settings\//, "");
  // Block prototype-polluting keys from an untrusted snapshot.
  if (isForbiddenSettingsKey(key)) {
    return { path: entry.relativePath, status: "error", error: `refusing dangerous settings key "${key}"` };
  }

  const settingsPath = join(claudeDir, "settings.json");
  const existing = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : {};

  if (entry.type === "removed") {
    delete existing[key];
  } else {
    // Expand portable placeholders back to real paths before parsing.
    const expanded = substituteForImport(entry.sourceContent ?? "null", homeDir, claudeDir);
    try {
      existing[key] = JSON.parse(expanded);
    } catch {
      existing[key] = expanded;
    }
  }

  atomicWrite(settingsPath, JSON.stringify(existing, null, 2));
  return { path: entry.relativePath, status: "ok" };
}

function updateSettings(claudeDir: string, updater: (settings: Record<string, unknown>) => void): void {
  const settingsPath = join(claudeDir, "settings.json");
  const existing = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : {};
  updater(existing);
  atomicWrite(settingsPath, JSON.stringify(existing, null, 2));
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
  const homeDir = homedir();

  for (const entry of selections) {
    try {
      if (entry.category === "settings") {
        applied.push(applySettingsEntry(entry, claudeDir, homeDir));
      } else if (entry.category === "plugins") {
        applied.push(applyPluginEntry(entry, claudeDir, pluginInstructions));
      } else if (entry.category === "marketplaces") {
        applied.push(applyMarketplaceEntry(entry, claudeDir, marketplaceInstructions));
      } else {
        // File-based categories: agents, rules, skills, commands, globalDocs, mcp
        applied.push(applyFileEntry(entry, claudeDir, homeDir));
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
