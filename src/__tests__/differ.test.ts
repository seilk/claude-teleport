import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diff } from "../differ.js";
import type { Snapshot } from "../types.js";

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    teleportVersion: "0.1.0",
    machineId: "test-id",
    machineAlias: "test-machine",
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
    ...overrides,
  };
}

describe("diff", () => {
  it("returns all unchanged for identical snapshots", () => {
    const agents = [{ relativePath: "agents/a.md", contentHash: "abc" }];
    const a = makeSnapshot({ agents });
    const b = makeSnapshot({ agents });
    const result = diff(a, b);
    assert.equal(result.added.length, 0);
    assert.equal(result.removed.length, 0);
    assert.equal(result.modified.length, 0);
    assert.ok(result.unchanged.length > 0);
  });

  it("detects added files (in source but not target)", () => {
    const source = makeSnapshot({
      agents: [{ relativePath: "agents/new.md", contentHash: "abc" }],
    });
    const target = makeSnapshot();
    const result = diff(source, target);
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].relativePath, "agents/new.md");
    assert.equal(result.added[0].category, "agents");
  });

  it("detects removed files (in target but not source)", () => {
    const source = makeSnapshot();
    const target = makeSnapshot({
      agents: [{ relativePath: "agents/old.md", contentHash: "abc" }],
    });
    const result = diff(source, target);
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].relativePath, "agents/old.md");
  });

  it("detects modified files (same path, different hash)", () => {
    const source = makeSnapshot({
      agents: [{ relativePath: "agents/a.md", contentHash: "new-hash", content: "new content" }],
    });
    const target = makeSnapshot({
      agents: [{ relativePath: "agents/a.md", contentHash: "old-hash", content: "old content" }],
    });
    const result = diff(source, target);
    assert.equal(result.modified.length, 1);
    assert.equal(result.modified[0].type, "modified");
  });

  it("diffs plugins by name+marketplace", () => {
    const source = makeSnapshot({
      plugins: [
        { name: "superpowers", marketplace: "official" },
        { name: "new-plugin", marketplace: "official" },
      ],
    });
    const target = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official" }],
    });
    const result = diff(source, target);
    assert.ok(result.added.some((e) => e.relativePath.includes("new-plugin")));
  });

  it("detects plugin version changes as modified", () => {
    const source = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official", version: "2.0.0" }],
    });
    const target = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official", version: "1.0.0" }],
    });
    const result = diff(source, target);
    assert.equal(result.modified.length, 1);
    assert.ok(result.modified[0].relativePath.includes("superpowers"));
    assert.ok(result.modified[0].sourceContent?.includes("2.0.0"));
  });

  it("detects plugin enabled state changes as modified", () => {
    const source = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official", version: "1.0.0", enabled: true }],
    });
    const target = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official", version: "1.0.0", enabled: false }],
    });
    const result = diff(source, target);
    assert.equal(result.modified.length, 1);
  });

  it("stores PluginEntry JSON in sourceContent for added plugins", () => {
    const source = makeSnapshot({
      plugins: [{ name: "superpowers", marketplace: "official", version: "1.0.0" }],
    });
    const target = makeSnapshot({ plugins: [] });
    const result = diff(source, target);
    const added = result.added.find((e) => e.category === "plugins");
    assert.ok(added);
    const parsed = JSON.parse(added.sourceContent!);
    assert.equal(parsed.name, "superpowers");
  });

  it("diffs marketplaces by name", () => {
    const source = makeSnapshot({
      marketplaces: [{ name: "official", source: { source: "github", repo: "anthropics/plugins" } }],
    });
    const target = makeSnapshot({ marketplaces: [] });
    const result = diff(source, target);
    assert.ok(result.added.some((e) => e.category === "marketplaces" && e.relativePath.includes("official")));
  });

  it("detects marketplace source changes as modified", () => {
    const source = makeSnapshot({
      marketplaces: [{ name: "my-market", source: { source: "github", repo: "user/new-repo" } }],
    });
    const target = makeSnapshot({
      marketplaces: [{ name: "my-market", source: { source: "github", repo: "user/old-repo" } }],
    });
    const result = diff(source, target);
    assert.equal(result.modified.filter((e) => e.category === "marketplaces").length, 1);
  });

  it("diffs settings key by key", () => {
    const source = makeSnapshot({
      settings: { theme: "dark", newKey: "value" },
    });
    const target = makeSnapshot({
      settings: { theme: "light" },
    });
    const result = diff(source, target);
    assert.ok(result.added.some((e) => e.relativePath.includes("newKey")));
    assert.ok(result.modified.some((e) => e.relativePath.includes("theme")));
  });

  it("marks auth-related settings as high risk", () => {
    const source = makeSnapshot({
      settings: { apiKey: "new-key" },
    });
    const target = makeSnapshot({
      settings: { apiKey: "old-key" },
    });
    const result = diff(source, target);
    const apiKeyDiff = result.modified.find((e) => e.relativePath.includes("apiKey"));
    assert.equal(apiKeyDiff?.riskLevel, "high");
  });
});
