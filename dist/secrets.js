import { readFileSync, existsSync } from "node:fs";
import { SECRET_PATTERNS, RCE_PATTERNS, CREDENTIAL_KEYS } from "./constants.js";
export function scanForSecrets(entries) {
    const findings = [];
    for (const entry of entries) {
        if (!entry.content)
            continue;
        const lines = entry.content.split("\n");
        for (const pattern of SECRET_PATTERNS) {
            for (let i = 0; i < lines.length; i++) {
                // Reset regex state for each line
                const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
                let match;
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
export function scanForRcePatterns(content) {
    const findings = [];
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
export function isCredentialKey(key) {
    const lower = key.toLowerCase();
    return CREDENTIAL_KEYS.some((ck) => lower.includes(ck.toLowerCase()));
}
// Recursively drop credential-keyed values at ANY depth (e.g. a secret hiding in
// mcpServers.foo.env.OPENAI_API_KEY), returning a new structure. Top-level-only
// filtering let nested secrets reach the hub.
export function redactCredentialsDeep(value) {
    if (Array.isArray(value))
        return value.map(redactCredentialsDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (isCredentialKey(key))
                continue;
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
export function snapshotScannableEntries(snapshot) {
    const entries = [
        ...(snapshot.agents ?? []),
        ...(snapshot.rules ?? []),
        ...(snapshot.skills ?? []),
        ...(snapshot.commands ?? []),
        ...(snapshot.globalDocs ?? []),
        ...(snapshot.mcp ?? []),
        ...(snapshot.scripts ?? []),
    ];
    if (snapshot.statuslineScript)
        entries.push(snapshot.statuslineScript);
    if (snapshot.keybindings)
        entries.push(snapshot.keybindings);
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
export function scanSnapshotForSecrets(snapshot) {
    return scanForSecrets(snapshotScannableEntries(snapshot));
}
export function loadIgnorePatterns(filePath) {
    if (!existsSync(filePath))
        return [];
    const content = readFileSync(filePath, "utf-8");
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
}
//# sourceMappingURL=secrets.js.map