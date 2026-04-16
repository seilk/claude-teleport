import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDiff } from "../applier.js";
import type { DiffEntry } from "../types.js";

describe("applyDiff", () => {
  let mockClaudeDir: string;

  beforeEach(() => {
    mockClaudeDir = mkdtempSync(join(tmpdir(), "teleport-apply-"));
    mkdirSync(join(mockClaudeDir, "agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(mockClaudeDir, { recursive: true, force: true });
  });

  it("copies added files to the target directory", async () => {
    const selections: DiffEntry[] = [
      {
        category: "agents",
        relativePath: "agents/new-agent.md",
        type: "added",
        sourceContent: "# New Agent\nDoes things.",
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].status, "ok");
    assert.ok(existsSync(join(mockClaudeDir, "agents", "new-agent.md")));
    assert.equal(readFileSync(join(mockClaudeDir, "agents", "new-agent.md"), "utf-8"), "# New Agent\nDoes things.");
  });

  it("overwrites modified files", async () => {
    writeFileSync(join(mockClaudeDir, "agents", "existing.md"), "old content");
    const selections: DiffEntry[] = [
      {
        category: "agents",
        relativePath: "agents/existing.md",
        type: "modified",
        sourceContent: "new content",
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.equal(result.applied[0].status, "ok");
    assert.equal(readFileSync(join(mockClaudeDir, "agents", "existing.md"), "utf-8"), "new content");
  });

  it("deep merges settings", async () => {
    writeFileSync(
      join(mockClaudeDir, "settings.json"),
      JSON.stringify({ existing: "value", theme: "light" })
    );
    const selections: DiffEntry[] = [
      {
        category: "settings",
        relativePath: "settings/theme",
        type: "modified",
        sourceContent: JSON.stringify("dark"),
      },
      {
        category: "settings",
        relativePath: "settings/newKey",
        type: "added",
        sourceContent: JSON.stringify("newValue"),
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.ok(result.applied.every((a) => a.status === "ok"));
    const settings = JSON.parse(readFileSync(join(mockClaudeDir, "settings.json"), "utf-8"));
    assert.equal(settings.theme, "dark");
    assert.equal(settings.newKey, "newValue");
    assert.equal(settings.existing, "value");
  });

  it("generates plugin install instructions with CLI command", async () => {
    const plugin = { name: "superpowers", marketplace: "claude-plugins-official", version: "5.0.7", enabled: true };
    const selections: DiffEntry[] = [
      {
        category: "plugins",
        relativePath: "plugins/claude-plugins-official/superpowers",
        type: "added",
        sourceContent: JSON.stringify(plugin),
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.ok(result.pluginInstructions.length > 0);
    assert.ok(result.pluginInstructions[0].includes("superpowers"));
    assert.ok(result.pluginInstructions[0].includes("claude-plugins-official"));
  });

  it("writes enabledPlugins to settings.json when applying a plugin", async () => {
    const plugin = { name: "superpowers", marketplace: "official", version: "1.0.0", enabled: true };
    const selections: DiffEntry[] = [
      {
        category: "plugins",
        relativePath: "plugins/official/superpowers",
        type: "added",
        sourceContent: JSON.stringify(plugin),
      },
    ];
    await applyDiff(selections, mockClaudeDir);
    const settings = JSON.parse(readFileSync(join(mockClaudeDir, "settings.json"), "utf-8"));
    assert.equal(settings.enabledPlugins["superpowers@official"], true);
  });

  it("generates plugin update instruction for version change", async () => {
    const sourcePlugin = { name: "superpowers", marketplace: "official", version: "2.0.0" };
    const targetPlugin = { name: "superpowers", marketplace: "official", version: "1.0.0" };
    const selections: DiffEntry[] = [
      {
        category: "plugins",
        relativePath: "plugins/official/superpowers",
        type: "modified",
        sourceContent: JSON.stringify(sourcePlugin),
        targetContent: JSON.stringify(targetPlugin),
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.ok(result.pluginInstructions.some((i) => i.includes("update")));
  });

  it("generates marketplace instructions and writes extraKnownMarketplaces", async () => {
    const marketplace = { name: "third-party", source: { source: "github", repo: "user/my-plugins" } };
    const selections: DiffEntry[] = [
      {
        category: "marketplaces",
        relativePath: "marketplaces/third-party",
        type: "added",
        sourceContent: JSON.stringify(marketplace),
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.ok(result.marketplaceInstructions.length > 0);
    assert.ok(result.marketplaceInstructions[0].includes("user/my-plugins"));
    const settings = JSON.parse(readFileSync(join(mockClaudeDir, "settings.json"), "utf-8"));
    assert.ok(settings.extraKnownMarketplaces["third-party"]);
  });

  it("fallback: generates install instruction when sourceContent is missing", async () => {
    const selections: DiffEntry[] = [
      {
        category: "plugins",
        relativePath: "plugins/official/superpowers",
        type: "added",
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.ok(result.pluginInstructions.length > 0);
    assert.ok(result.pluginInstructions[0].includes("superpowers"));
  });

  it("creates intermediate directories for nested paths", async () => {
    const selections: DiffEntry[] = [
      {
        category: "rules",
        relativePath: "rules/common/coding-style.md",
        type: "added",
        sourceContent: "# Coding Style",
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.equal(result.applied[0].status, "ok");
    assert.ok(existsSync(join(mockClaudeDir, "rules", "common", "coding-style.md")));
  });

  it("chmods scripts with a shebang to 0o755", { skip: process.platform === "win32" }, async () => {
    const selections: DiffEntry[] = [
      {
        category: "scripts",
        relativePath: "scripts/hooks/post-edit.sh",
        type: "added",
        sourceContent: "#!/usr/bin/env bash\necho hi",
      },
    ];
    const result = await applyDiff(selections, mockClaudeDir);
    assert.equal(result.applied[0].status, "ok");
    const targetPath = join(mockClaudeDir, "scripts", "hooks", "post-edit.sh");
    assert.ok(existsSync(targetPath));
    // Check owner-executable bit is set (portable across most unixes).
    const mode = statSync(targetPath).mode & 0o777;
    assert.ok((mode & 0o100) !== 0, `expected owner-executable bit, got mode=${mode.toString(8)}`);
  });

  it("does not chmod non-shebang files", { skip: process.platform === "win32" }, async () => {
    const selections: DiffEntry[] = [
      {
        category: "rules",
        relativePath: "rules/plain.md",
        type: "added",
        sourceContent: "# Just markdown, no shebang\n",
      },
    ];
    await applyDiff(selections, mockClaudeDir);
    const targetPath = join(mockClaudeDir, "rules", "plain.md");
    const mode = statSync(targetPath).mode & 0o777;
    assert.equal(mode & 0o100, 0, `expected no owner-executable bit, got mode=${mode.toString(8)}`);
  });
});
