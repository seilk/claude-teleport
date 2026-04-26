import type { Snapshot, Diff, DiffEntry, DiffSummary, FileEntry, PluginEntry, Marketplace } from "./types.js";
import { isCredentialKey } from "./secrets.js";

const FILE_CATEGORIES = [
  "agents", "rules", "skills", "commands", "globalDocs", "mcp", "scripts",
] as const;

function diffFileEntries(
  source: readonly FileEntry[],
  target: readonly FileEntry[],
  category: string,
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[]; unchanged: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const targetMap = new Map(target.map((e) => [e.relativePath, e]));
  const sourceMap = new Map(source.map((e) => [e.relativePath, e]));

  for (const entry of source) {
    const targetEntry = targetMap.get(entry.relativePath);
    if (!targetEntry) {
      added.push({ category, relativePath: entry.relativePath, type: "added", sourceContent: entry.content });
    } else if (entry.contentHash !== targetEntry.contentHash) {
      modified.push({
        category,
        relativePath: entry.relativePath,
        type: "modified",
        sourceContent: entry.content,
        targetContent: targetEntry.content,
      });
    } else {
      unchanged.push({ category, relativePath: entry.relativePath, type: "unchanged" });
    }
  }

  for (const entry of target) {
    if (!sourceMap.has(entry.relativePath)) {
      removed.push({ category, relativePath: entry.relativePath, type: "removed", targetContent: entry.content });
    }
  }

  return { added, removed, modified, unchanged };
}

function diffPlugins(
  source: readonly PluginEntry[],
  target: readonly PluginEntry[],
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[]; unchanged: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const key = (p: PluginEntry) => `${p.marketplace}/${p.name}`;
  const targetMap = new Map(target.map((p) => [key(p), p]));
  const sourceKeys = new Set(source.map(key));

  for (const p of source) {
    const k = key(p);
    const targetPlugin = targetMap.get(k);
    if (!targetPlugin) {
      added.push({
        category: "plugins",
        relativePath: `plugins/${k}`,
        type: "added",
        sourceContent: JSON.stringify(p),
      });
    } else if (p.version !== targetPlugin.version || p.enabled !== targetPlugin.enabled) {
      modified.push({
        category: "plugins",
        relativePath: `plugins/${k}`,
        type: "modified",
        sourceContent: JSON.stringify(p),
        targetContent: JSON.stringify(targetPlugin),
      });
    } else {
      unchanged.push({ category: "plugins", relativePath: `plugins/${k}`, type: "unchanged" });
    }
  }

  for (const p of target) {
    if (!sourceKeys.has(key(p))) {
      removed.push({
        category: "plugins",
        relativePath: `plugins/${key(p)}`,
        type: "removed",
        targetContent: JSON.stringify(p),
      });
    }
  }

  return { added, removed, modified, unchanged };
}

function diffMarketplaces(
  source: readonly Marketplace[],
  target: readonly Marketplace[],
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[]; unchanged: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const targetMap = new Map(target.map((m) => [m.name, m]));
  const sourceNames = new Set(source.map((m) => m.name));

  for (const m of source) {
    const targetMarket = targetMap.get(m.name);
    if (!targetMarket) {
      added.push({
        category: "marketplaces",
        relativePath: `marketplaces/${m.name}`,
        type: "added",
        sourceContent: JSON.stringify(m),
      });
    } else if (JSON.stringify(m.source) !== JSON.stringify(targetMarket.source)) {
      modified.push({
        category: "marketplaces",
        relativePath: `marketplaces/${m.name}`,
        type: "modified",
        sourceContent: JSON.stringify(m),
        targetContent: JSON.stringify(targetMarket),
      });
    } else {
      unchanged.push({ category: "marketplaces", relativePath: `marketplaces/${m.name}`, type: "unchanged" });
    }
  }

  for (const m of target) {
    if (!sourceNames.has(m.name)) {
      removed.push({
        category: "marketplaces",
        relativePath: `marketplaces/${m.name}`,
        type: "removed",
        targetContent: JSON.stringify(m),
      });
    }
  }

  return { added, removed, modified, unchanged };
}

function diffSettings(
  source: Readonly<Record<string, unknown>>,
  target: Readonly<Record<string, unknown>>,
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[]; unchanged: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const allKeys = new Set([...Object.keys(source), ...Object.keys(target)]);

  for (const key of allKeys) {
    const inSource = key in source;
    const inTarget = key in target;
    const riskLevel = isCredentialKey(key) ? "high" as const : "low" as const;
    const path = `settings/${key}`;

    if (inSource && !inTarget) {
      added.push({
        category: "settings",
        relativePath: path,
        type: "added",
        sourceContent: JSON.stringify(source[key]),
        riskLevel,
      });
    } else if (!inSource && inTarget) {
      removed.push({
        category: "settings",
        relativePath: path,
        type: "removed",
        targetContent: JSON.stringify(target[key]),
        riskLevel,
      });
    } else if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) {
      modified.push({
        category: "settings",
        relativePath: path,
        type: "modified",
        sourceContent: JSON.stringify(source[key]),
        targetContent: JSON.stringify(target[key]),
        riskLevel,
      });
    } else {
      unchanged.push({ category: "settings", relativePath: path, type: "unchanged" });
    }
  }

  return { added, removed, modified, unchanged };
}

function buildSummary(
  added: readonly DiffEntry[],
  modified: readonly DiffEntry[],
  removed: readonly DiffEntry[],
): DiffSummary {
  const countByCategory = (entries: readonly DiffEntry[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    }
    return counts;
  };
  return {
    added: countByCategory(added),
    modified: countByCategory(modified),
    removed: countByCategory(removed),
    hasChanges: added.length > 0 || modified.length > 0 || removed.length > 0,
  };
}

export function diff(source: Snapshot, target: Snapshot): Diff {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const merge = (result: { added?: DiffEntry[]; removed?: DiffEntry[]; modified?: DiffEntry[]; unchanged?: DiffEntry[] }) => {
    if (result.added) added.push(...result.added);
    if (result.removed) removed.push(...result.removed);
    if (result.modified) modified.push(...result.modified);
    if (result.unchanged) unchanged.push(...result.unchanged);
  };

  for (const cat of FILE_CATEGORIES) {
    // Tolerate older snapshots (pre-scripts release) that lack a field entirely.
    const sourceEntries = (source[cat] ?? []) as readonly FileEntry[];
    const targetEntries = (target[cat] ?? []) as readonly FileEntry[];
    merge(diffFileEntries(sourceEntries, targetEntries, cat));
  }

  merge(diffPlugins(source.plugins, target.plugins));
  merge(diffMarketplaces(source.marketplaces, target.marketplaces));
  merge(diffSettings(source.settings, target.settings));

  // Diff keybindings
  diffSingleFile(
    source.keybindings,
    target.keybindings,
    "keybindings",
    "keybindings.json",
    { added, removed, modified, unchanged },
  );

  // Diff statusline script
  diffSingleFile(
    source.statuslineScript,
    target.statuslineScript,
    "statuslineScript",
    source.statuslineScript?.relativePath ?? target.statuslineScript?.relativePath ?? "statusline-command.sh",
    { added, removed, modified, unchanged },
  );

  return { added, removed, modified, unchanged, summary: buildSummary(added, modified, removed) };
}

function diffSingleFile(
  source: FileEntry | undefined,
  target: FileEntry | undefined,
  category: string,
  relativePath: string,
  buckets: { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[]; unchanged: DiffEntry[] },
): void {
  if (source && !target) {
    buckets.added.push({
      category,
      relativePath,
      type: "added",
      sourceContent: source.content,
    });
  } else if (!source && target) {
    buckets.removed.push({
      category,
      relativePath,
      type: "removed",
      targetContent: target.content,
    });
  } else if (source && target && source.contentHash !== target.contentHash) {
    buckets.modified.push({
      category,
      relativePath,
      type: "modified",
      sourceContent: source.content,
      targetContent: target.content,
    });
  } else if (source && target) {
    buckets.unchanged.push({ category, relativePath, type: "unchanged" });
  }
}
