import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { FileEntry } from "./types.js";
import { substituteForExport } from "./paths.js";
import { IGNORED_SCAN_DIRS } from "./constants.js";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isTextFile(filePath: string): boolean {
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

// When homeDir/claudeDir are provided, file content is normalized to the
// portable $HOME/$CLAUDE_DIR form before hashing, so neither the snapshot nor
// the content hash carries machine-specific absolute paths. Reading already
// portable hub content (no homeDir/claudeDir) leaves it untouched.
export function scanDirectoryToFileEntries(
  baseDir: string,
  dirPath: string,
  category: string,
  homeDir?: string,
  claudeDir?: string,
): FileEntry[] {
  const fullPath = join(baseDir, dirPath);
  if (!existsSync(fullPath)) return [];

  const entries: FileEntry[] = [];

  function walk(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const itemPath = join(dir, item.name);
      if (item.isDirectory()) {
        if (IGNORED_SCAN_DIRS.has(item.name)) continue;
        walk(itemPath);
      } else if (item.isFile() && isTextFile(itemPath)) {
        const raw = readFileSync(itemPath, "utf-8");
        const content =
          homeDir && claudeDir
            ? substituteForExport(raw, homeDir, claudeDir)
            : raw;
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
