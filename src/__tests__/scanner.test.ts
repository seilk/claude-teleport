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
      JSON.stringify({
        version: 2,
        plugins: {
          "superpowers@official": [{ scope: "user", version: "1.0.0", gitCommitSha: "abc123" }],
        },
      })
    );
    writeFileSync(
      join(mockClaudeDir, "plugins", "known_marketplaces.json"),
      JSON.stringify({
        official: { source: { source: "github", repo: "anthropics/claude-plugins" }, installLocation: "/tmp/test", lastUpdated: "2026-01-01T00:00:00Z" },
      })
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

  it("scans installed plugins from v2 format", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.plugins.length, 1);
    assert.equal(snapshot.plugins[0].name, "superpowers");
    assert.equal(snapshot.plugins[0].marketplace, "official");
    assert.equal(snapshot.plugins[0].version, "1.0.0");
    assert.equal(snapshot.plugins[0].scope, "user");
    assert.equal(snapshot.plugins[0].gitCommitSha, "abc123");
  });

  it("reads enabled state from settings.json enabledPlugins", async () => {
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({ theme: "dark", enabledPlugins: { "superpowers@official": true } })
    );
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.plugins[0].enabled, true);
  });

  it("scans plugins from v1 fallback format", async () => {
    writeFileSync(
      join(mockClaudeDir, "plugins", "installed_plugins.json"),
      JSON.stringify([{ name: "legacy-plugin", marketplace: "old-market", version: "2.0.0" }])
    );
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.plugins.length, 1);
    assert.equal(snapshot.plugins[0].name, "legacy-plugin");
  });

  it("scans known marketplaces from object format", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.marketplaces.length, 1);
    assert.equal(snapshot.marketplaces[0].name, "official");
    assert.equal(snapshot.marketplaces[0].source.source, "github");
    assert.equal(snapshot.marketplaces[0].source.repo, "anthropics/claude-plugins");
  });

  it("merges extraKnownMarketplaces from settings.json", async () => {
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({
        extraKnownMarketplaces: {
          "third-party": { source: { source: "github", repo: "user/my-plugins" } },
        },
      })
    );
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.ok(snapshot.marketplaces.some((m) => m.name === "third-party"));
    assert.ok(snapshot.marketplaces.some((m) => m.name === "official"));
  });

  it("does not duplicate marketplaces present in both known_marketplaces and extraKnownMarketplaces", async () => {
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({
        extraKnownMarketplaces: {
          official: { source: { source: "github", repo: "anthropics/claude-plugins" } },
        },
      })
    );
    const snapshot = await scanClaudeDir(mockClaudeDir);
    const officialEntries = snapshot.marketplaces.filter((m) => m.name === "official");
    assert.equal(officialEntries.length, 1);
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

  it("scans scripts directory recursively", async () => {
    mkdirSync(join(mockClaudeDir, "scripts", "hooks"), { recursive: true });
    mkdirSync(join(mockClaudeDir, "scripts", "lib"), { recursive: true });
    writeFileSync(join(mockClaudeDir, "scripts", "hooks", "post-edit.js"), "#!/usr/bin/env node\nconsole.log('hi')");
    writeFileSync(join(mockClaudeDir, "scripts", "hooks", "pre-bash.sh"), "#!/usr/bin/env bash\necho hi");
    writeFileSync(join(mockClaudeDir, "scripts", "lib", "shared.js"), "export const x = 1;");
    writeFileSync(join(mockClaudeDir, "scripts", "orchestrate.sh"), "#!/usr/bin/env bash\necho ok");

    const snapshot = await scanClaudeDir(mockClaudeDir);

    assert.equal(snapshot.scripts.length, 4);
    assert.ok(snapshot.scripts.some((s) => s.relativePath === "scripts/hooks/post-edit.js"));
    assert.ok(snapshot.scripts.some((s) => s.relativePath === "scripts/hooks/pre-bash.sh"));
    assert.ok(snapshot.scripts.some((s) => s.relativePath === "scripts/lib/shared.js"));
    assert.ok(snapshot.scripts.some((s) => s.relativePath === "scripts/orchestrate.sh"));
  });

  it("returns empty scripts when scripts directory is missing", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.scripts.length, 0);
  });

  it("scans hooks.json from canonical hooks/ subdirectory", async () => {
    mkdirSync(join(mockClaudeDir, "hooks"), { recursive: true });
    writeFileSync(
      join(mockClaudeDir, "hooks", "hooks.json"),
      JSON.stringify([
        { name: "format-on-edit", event: "PostToolUse", command: "prettier --write" },
      ]),
    );

    const snapshot = await scanClaudeDir(mockClaudeDir);

    assert.equal(snapshot.hooks.length, 1);
    assert.equal(snapshot.hooks[0].name, "format-on-edit");
    assert.equal(snapshot.hooks[0].event, "PostToolUse");
  });

  it("falls back to legacy hooks.json at claude root", async () => {
    writeFileSync(
      join(mockClaudeDir, "hooks.json"),
      JSON.stringify([{ name: "legacy", event: "Stop", command: "echo done" }]),
    );

    const snapshot = await scanClaudeDir(mockClaudeDir);

    assert.equal(snapshot.hooks.length, 1);
    assert.equal(snapshot.hooks[0].name, "legacy");
  });

  it("prefers hooks/hooks.json over legacy locations when both exist", async () => {
    mkdirSync(join(mockClaudeDir, "hooks"), { recursive: true });
    writeFileSync(
      join(mockClaudeDir, "hooks", "hooks.json"),
      JSON.stringify([{ name: "canonical", event: "Stop", command: "echo a" }]),
    );
    writeFileSync(
      join(mockClaudeDir, "hooks.json"),
      JSON.stringify([{ name: "legacy", event: "Stop", command: "echo b" }]),
    );

    const snapshot = await scanClaudeDir(mockClaudeDir);

    assert.equal(snapshot.hooks.length, 1);
    assert.equal(snapshot.hooks[0].name, "canonical");
  });

  it("scans statusline-command.sh when present", async () => {
    writeFileSync(
      join(mockClaudeDir, "statusline-command.sh"),
      "#!/usr/bin/env bash\necho 'status'",
    );

    const snapshot = await scanClaudeDir(mockClaudeDir);

    assert.ok(snapshot.statuslineScript);
    assert.equal(snapshot.statuslineScript?.relativePath, "statusline-command.sh");
    assert.match(snapshot.statuslineScript!.contentHash, /^[a-f0-9]{64}$/);
  });

  it("returns undefined statuslineScript when missing", async () => {
    const snapshot = await scanClaudeDir(mockClaudeDir);
    assert.equal(snapshot.statuslineScript, undefined);
  });
});
