import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanClaudeDir } from "../scanner.js";

describe("scanClaudeDir", () => {
  let mockClaudeDir: string;

  beforeEach(() => {
    mockClaudeDir = mkdtempSync(join(tmpdir(), "teleport-claude-"));

    // Create mock directory structure
    mkdirSync(join(mockClaudeDir, "agents"), { recursive: true });
    mkdirSync(join(mockClaudeDir, "rules"), { recursive: true });
    mkdirSync(join(mockClaudeDir, "skills"), { recursive: true });
    mkdirSync(join(mockClaudeDir, "plugins"), { recursive: true });

    // Create mock files
    writeFileSync(join(mockClaudeDir, "agents", "planner.md"), "# Planner Agent");
    writeFileSync(join(mockClaudeDir, "agents", "reviewer.md"), "# Reviewer Agent");
    writeFileSync(join(mockClaudeDir, "rules", "coding-style.md"), "# Style Guide");
    writeFileSync(join(mockClaudeDir, "CLAUDE.md"), "# Global Config");
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({ theme: "dark", enabledPlugins: ["superpowers"] })
    );
    writeFileSync(
      join(mockClaudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify([{ name: "superpowers", marketplace: "official", version: "1.0.0" }])
    );
    writeFileSync(
      join(mockClaudeDir, "plugins", "known_marketplaces.json"),
      JSON.stringify([{ name: "official", repo: "https://github.com/anthropics/claude-plugins" }])
    );
  });

  afterEach(() => {
    rmSync(mockClaudeDir, { recursive: true, force: true });
  });

  it("scans agents directory", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.agents.length, 2);
    assert.ok(snapshot.agents.some((a) => a.relativePath === "agents/planner.md"));
    assert.ok(snapshot.agents.some((a) => a.relativePath === "agents/reviewer.md"));
  });

  it("includes content hash for each file", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    for (const agent of snapshot.agents) {
      assert.ok(agent.contentHash);
      assert.match(agent.contentHash, /^[a-f0-9]{64}$/);
    }
  });

  it("includes file content", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    const planner = snapshot.agents.find((a) => a.relativePath === "agents/planner.md");
    assert.equal(planner?.content, "# Planner Agent");
  });

  it("scans rules directory", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.rules.length, 1);
  });

  it("scans global docs (CLAUDE.md)", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.ok(snapshot.globalDocs.some((d) => d.relativePath === "CLAUDE.md"));
  });

  it("scans settings.json excluding credential keys", async () => {
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({ theme: "dark", credentials: { key: "secret" }, enabledPlugins: [] })
    );
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.ok("theme" in snapshot.settings);
    assert.ok("enabledPlugins" in snapshot.settings);
    assert.ok(!("credentials" in snapshot.settings));
  });

  it("scans installed plugins", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.plugins.length, 1);
    assert.equal(snapshot.plugins[0].name, "superpowers");
  });

  it("scans known marketplaces", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.marketplaces.length, 1);
    assert.equal(snapshot.marketplaces[0].name, "official");
  });

  it("handles missing directories gracefully", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "teleport-empty-"));
    try {
      const snapshot = await scanClaudeDir(emptyDir);
      assert.equal(snapshot.agents.length, 0);
      assert.equal(snapshot.rules.length, 0);
      assert.equal(snapshot.plugins.length, 0);
      assert.deepEqual(snapshot.settings, {});
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("includes teleportVersion and machine info", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.teleportVersion, "0.1.0");
    assert.ok(snapshot.machineId);
    assert.ok(snapshot.machineAlias);
  });
});
