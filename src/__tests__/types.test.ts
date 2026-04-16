import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  FileEntry,
  PluginEntry,
  Marketplace,
  HookEntry,
  Snapshot,
  DiffEntry,
  Diff,
  BackupManifest,
  TeleportConfig,
  ApplyResult,
  SecretFinding,
} from "../types.js";
import {
  TELEPORT_VERSION,
  CLAUDE_DIR,
  CATEGORY_PATHS,
  SECRET_PATTERNS,
  RCE_PATTERNS,
  DEFAULT_IGNORE_PATTERNS,
  CREDENTIAL_KEYS,
} from "../constants.js";

describe("types", () => {
  it("FileEntry can be constructed with required fields", () => {
    const entry: FileEntry = {
      relativePath: "agents/planner.md",
      contentHash: "abc123",
    };
    assert.equal(entry.relativePath, "agents/planner.md");
    assert.equal(entry.contentHash, "abc123");
    assert.equal(entry.content, undefined);
  });

  it("FileEntry can include optional content", () => {
    const entry: FileEntry = {
      relativePath: "CLAUDE.md",
      contentHash: "def456",
      content: "# My config",
    };
    assert.equal(entry.content, "# My config");
  });

  it("Snapshot has all required category fields", () => {
    const snapshot: Snapshot = {
      teleportVersion: "0.1.0",
      machineId: "uuid-123",
      machineAlias: "macbook-pro",
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
    };
    assert.equal(snapshot.teleportVersion, "0.1.0");
    assert.equal(snapshot.machineAlias, "macbook-pro");
    assert.equal(snapshot.keybindings, undefined);
    assert.equal(snapshot.statuslineScript, undefined);
    assert.equal(snapshot.scripts.length, 0);
  });

  it("DiffEntry supports all diff types", () => {
    const types: DiffEntry["type"][] = [
      "added",
      "removed",
      "modified",
      "unchanged",
    ];
    for (const type of types) {
      const entry: DiffEntry = {
        category: "agents",
        relativePath: "agents/foo.md",
        type,
      };
      assert.equal(entry.type, type);
    }
  });

  it("Diff groups entries by type", () => {
    const diff: Diff = {
      added: [
        { category: "agents", relativePath: "agents/new.md", type: "added" },
      ],
      removed: [],
      modified: [],
      unchanged: [],
    };
    assert.equal(diff.added.length, 1);
    assert.equal(diff.removed.length, 0);
  });

  it("SecretFinding captures pattern match details", () => {
    const finding: SecretFinding = {
      file: "settings.json",
      line: 5,
      pattern: "AWS Access Key",
      severity: "critical",
      match: "AKIA1234567890ABCDEF",
    };
    assert.equal(finding.severity, "critical");
    assert.equal(finding.line, 5);
  });

  it("ApplyResult tracks success and failure", () => {
    const result: ApplyResult = {
      applied: [
        { path: "agents/foo.md", status: "ok" },
        { path: "rules/bar.md", status: "error", error: "Permission denied" },
      ],
      pluginInstructions: ["Run: /install-plugin superpowers"],
      marketplaceInstructions: [],
    };
    assert.equal(result.applied.length, 2);
    assert.equal(result.applied[1].status, "error");
  });
});

describe("constants", () => {
  it("TELEPORT_VERSION is 0.1.0", () => {
    assert.equal(TELEPORT_VERSION, "0.1.0");
  });

  it("CLAUDE_DIR points to ~/.claude", () => {
    assert.ok(CLAUDE_DIR.endsWith(".claude"));
  });

  it("CATEGORY_PATHS maps all syncable categories", () => {
    assert.ok("agents" in CATEGORY_PATHS);
    assert.ok("rules" in CATEGORY_PATHS);
    assert.ok("skills" in CATEGORY_PATHS);
    assert.ok("commands" in CATEGORY_PATHS);
    assert.ok("mcp" in CATEGORY_PATHS);
  });

  it("SECRET_PATTERNS has entries with name, regex, severity", () => {
    assert.ok(SECRET_PATTERNS.length > 0);
    for (const pattern of SECRET_PATTERNS) {
      assert.ok(pattern.name);
      assert.ok(pattern.regex instanceof RegExp);
      assert.ok(["critical", "high", "medium"].includes(pattern.severity));
    }
  });

  it("RCE_PATTERNS contains known dangerous patterns", () => {
    assert.ok(RCE_PATTERNS.includes("curl "));
    assert.ok(RCE_PATTERNS.includes("eval("));
    assert.ok(RCE_PATTERNS.includes("| bash"));
  });

  it("DEFAULT_IGNORE_PATTERNS excludes sensitive paths", () => {
    assert.ok(DEFAULT_IGNORE_PATTERNS.includes(".credentials.json"));
    assert.ok(DEFAULT_IGNORE_PATTERNS.includes("settings.local.json"));
    assert.ok(DEFAULT_IGNORE_PATTERNS.includes("sessions/"));
  });

  it("CREDENTIAL_KEYS lists sensitive setting keys", () => {
    assert.ok(CREDENTIAL_KEYS.includes("credentials"));
    assert.ok(CREDENTIAL_KEYS.includes("apiKey"));
    assert.ok(CREDENTIAL_KEYS.includes("password"));
  });
});
