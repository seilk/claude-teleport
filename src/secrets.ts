import { readFileSync, existsSync } from "node:fs";
import { SECRET_PATTERNS, RCE_PATTERNS, CREDENTIAL_KEYS } from "./constants.js";
import type { FileEntry, SecretFinding, Snapshot } from "./types.js";

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

// Split a key into lowercase word tokens across camelCase and separator
// boundaries: "ANTHROPIC_API_KEY" -> [anthropic, api, key], "apiKey" -> [api, key].
function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

function containsTokenRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((tok, j) => haystack[i + j] === tok)) return true;
  }
  return false;
}

const CREDENTIAL_KEY_TOKENS = CREDENTIAL_KEYS.map(tokenizeKey);

// Match credential terms on word boundaries, not raw substrings: a benign key
// like "author" or "tokenizer" must NOT be treated as "auth"/"token", while
// "ANTHROPIC_API_KEY" / "accessToken" still match. Substring matching silently
// dropped legitimate settings (data loss), made worse once applied recursively.
export function isCredentialKey(key: string): boolean {
  const tokens = tokenizeKey(key);
  return CREDENTIAL_KEY_TOKENS.some((needle) => containsTokenRun(tokens, needle));
}

// Recursively drop credential-keyed values at ANY depth (e.g. a secret hiding in
// mcpServers.foo.env.OPENAI_API_KEY), returning a new structure. Top-level-only
// filtering let nested secrets reach the hub.
export function redactCredentialsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentialsDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isCredentialKey(key)) continue;
      out[key] = redactCredentialsDeep(child);
    }
    return out;
  }
  return value;
}

// Flatten every committed surface of a snapshot into scannable text entries,
// INCLUDING settings values and hook commands — surfaces that the old file-only
// scan never inspected, so a secret pasted into settings.json was published
// unscanned.
export function snapshotScannableEntries(snapshot: Snapshot): FileEntry[] {
  const entries: FileEntry[] = [
    ...(snapshot.agents ?? []),
    ...(snapshot.rules ?? []),
    ...(snapshot.skills ?? []),
    ...(snapshot.commands ?? []),
    ...(snapshot.globalDocs ?? []),
    ...(snapshot.mcp ?? []),
    ...(snapshot.scripts ?? []),
  ];
  if (snapshot.statuslineScript) entries.push(snapshot.statuslineScript);
  if (snapshot.keybindings) entries.push(snapshot.keybindings);
  if (snapshot.settings && Object.keys(snapshot.settings).length > 0) {
    entries.push({
      relativePath: "settings.json",
      contentHash: "",
      content: JSON.stringify(snapshot.settings, null, 2),
    });
  }
  for (const hook of snapshot.hooks ?? []) {
    if (hook.command) {
      entries.push({ relativePath: `hooks.json#${hook.name}`, contentHash: "", content: hook.command });
    }
  }
  return entries;
}

export function scanSnapshotForSecrets(snapshot: Snapshot): SecretFinding[] {
  return scanForSecrets(snapshotScannableEntries(snapshot));
}

export function loadIgnorePatterns(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}
