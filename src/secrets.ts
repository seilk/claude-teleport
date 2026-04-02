import { readFileSync, existsSync } from "node:fs";
import { SECRET_PATTERNS, RCE_PATTERNS, CREDENTIAL_KEYS } from "./constants.js";
import type { FileEntry, SecretFinding } from "./types.js";

export function scanForSecrets(entries: readonly FileEntry[]): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const entry of entries) {
    if (!entry.content) continue;

    const lines = entry.content.split("\n");
    for (const pattern of SECRET_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        // Reset regex state for each line
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(lines[i])) !== null) {
          findings.push({
            file: entry.relativePath,
            line: i + 1,
            pattern: pattern.name,
            severity: pattern.severity,
            match: match[0],
          });
        }
      }
    }
  }

  return findings;
}

export function scanForRcePatterns(content: string): string[] {
  const findings: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of RCE_PATTERNS) {
      if (line.includes(pattern)) {
        findings.push(`Line ${i + 1}: found "${pattern}" in "${line.trim()}"`);
      }
    }
  }

  return findings;
}

export function isCredentialKey(key: string): boolean {
  const lower = key.toLowerCase();
  return CREDENTIAL_KEYS.some((ck) => lower.includes(ck.toLowerCase()));
}

export function loadIgnorePatterns(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
