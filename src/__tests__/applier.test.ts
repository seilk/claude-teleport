import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
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

  it("generates plugin install instructions", async () => {
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
});
