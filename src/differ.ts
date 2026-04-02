import type { Snapshot, Diff, DiffEntry, FileEntry, PluginEntry } from "./types.js";
import { isCredentialKey } from "./secrets.js";

const FILE_CATEGORIES = [
  "agents", "rules", "skills", "commands", "globalDocs", "mcp",
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
): { added: DiffEntry[]; removed: DiffEntry[]; unchanged: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  const key = (p: PluginEntry) => `${p.marketplace}/${p.name}`;
  const targetKeys = new Set(target.map(key));
  const sourceKeys = new Set(source.map(key));

  for (const p of source) {
    const k = key(p);
    if (targetKeys.has(k)) {
      unchanged.push({ category: "plugins", relativePath: `plugins/${k}`, type: "unchanged" });
    } else {
      added.push({ category: "plugins", relativePath: `plugins/${k}`, type: "added" });
    }
  }

  for (const p of target) {
    if (!sourceKeys.has(key(p))) {
      removed.push({ category: "plugins", relativePath: `plugins/${key(p)}`, type: "removed" });
    }
  }

  return { added, removed, unchanged };
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
      added.push({ category: "settings", relativePath: path, type: "added", riskLevel });
    } else if (!inSource && inTarget) {
      removed.push({ category: "settings", relativePath: path, type: "removed", riskLevel });
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
    const sourceEntries = source[cat] as readonly FileEntry[];
    const targetEntries = target[cat] as readonly FileEntry[];
    merge(diffFileEntries(sourceEntries, targetEntries, cat));
  }

  merge(diffPlugins(source.plugins, target.plugins));
  merge(diffSettings(source.settings, target.settings));

  return { added, removed, modified, unchanged };
}
