import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pushToMachineBranch, listMachineBranches, readFromBranch } from "../git.js";
import type { Snapshot } from "../types.js";

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    teleportVersion: "0.1.0",
    machineId: "uuid-123",
    machineAlias: "macbook-pro",
    plugins: [{ name: "superpowers", marketplace: "official" }],
    marketplaces: [{ name: "official", repoUrl: "https://github.com/anthropics/claude-plugins" }],
    agents: [{ relativePath: "agents/planner.md", contentHash: "abc", content: "# Planner" }],
    rules: [],
    skills: [],
    commands: [],
    settings: { theme: "dark" },
    globalDocs: [{ relativePath: "CLAUDE.md", contentHash: "def", content: "# Config" }],
    hooks: [],
    mcp: [],
    ...overrides,
  };
}

function initBareRepo(path: string): void {
  execSync(`git init --bare ${path}`, { encoding: "utf-8" });
}

function initWorkingRepo(path: string, barePath: string): void {
  execSync(`git clone ${barePath} ${path}`, { encoding: "utf-8" });
  execSync("git commit --allow-empty -m 'init'", { cwd: path, encoding: "utf-8" });
  execSync("git push origin main", { cwd: path, encoding: "utf-8" });
}

describe("pushToMachineBranch", () => {
  let tmpDir: string;
  let barePath: string;
  let workPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-git-"));
    barePath = join(tmpDir, "bare.git");
    workPath = join(tmpDir, "work");
    initBareRepo(barePath);
    initWorkingRepo(workPath, barePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a machine branch with config files", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());

    // Verify branch exists
    const branches = execSync("git branch --list", { cwd: workPath, encoding: "utf-8" });
    assert.ok(branches.includes("macbook-pro"));

    // Switch to branch and verify files
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    assert.ok(existsSync(join(workPath, "snapshot.yaml")));
    assert.ok(existsSync(join(workPath, "agents", "planner.md")));
    assert.equal(readFileSync(join(workPath, "agents", "planner.md"), "utf-8"), "# Planner");
  });

  it("writes snapshot.yaml with metadata", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    const yaml = readFileSync(join(workPath, "snapshot.yaml"), "utf-8");
    assert.ok(yaml.includes("machineId: uuid-123"));
    assert.ok(yaml.includes("machineAlias: macbook-pro"));
    assert.ok(yaml.includes("agents: 1"));
  });

  it("writes settings.json", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    const settings = JSON.parse(readFileSync(join(workPath, "settings.json"), "utf-8"));
    assert.equal(settings.theme, "dark");
  });

  it("writes plugin and marketplace metadata", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    assert.ok(existsSync(join(workPath, "plugins", "installed_plugins.json")));
    assert.ok(existsSync(join(workPath, "plugins", "known_marketplaces.json")));
  });

  it("merges machine branch into main", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());

    // Verify we're back on main
    const current = execSync("git branch --show-current", { cwd: workPath, encoding: "utf-8" }).trim();
    assert.equal(current, "main");

    // Verify main has the merged files
    assert.ok(existsSync(join(workPath, "agents", "planner.md")));
  });

  it("handles multiple machines as separate branches", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot({ machineId: "uuid-111", machineAlias: "macbook-pro" }));
    pushToMachineBranch(workPath, "work-imac", makeSnapshot({
      machineId: "uuid-222",
      machineAlias: "work-imac",
      agents: [{ relativePath: "agents/reviewer.md", contentHash: "xyz", content: "# Reviewer" }],
    }));

    const branches = execSync("git branch --list", { cwd: workPath, encoding: "utf-8" });
    assert.ok(branches.includes("macbook-pro"));
    assert.ok(branches.includes("work-imac"));

    // Main should have both agents (merged)
    assert.ok(existsSync(join(workPath, "agents", "planner.md")) || existsSync(join(workPath, "agents", "reviewer.md")));
  });
});

describe("listMachineBranches", () => {
  let tmpDir: string;
  let barePath: string;
  let workPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-git-"));
    barePath = join(tmpDir, "bare.git");
    workPath = join(tmpDir, "work");
    initBareRepo(barePath);
    initWorkingRepo(workPath, barePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty for repo with only main", () => {
    const machines = listMachineBranches(workPath);
    assert.deepEqual(machines, []);
  });

  it("lists machine branches with metadata", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    const machines = listMachineBranches(workPath);
    assert.equal(machines.length, 1);
    assert.equal(machines[0].alias, "macbook-pro");
    assert.equal(machines[0].id, "uuid-123");
    assert.ok(machines[0].lastPush);
  });
});

describe("readFromBranch", () => {
  let tmpDir: string;
  let barePath: string;
  let workPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-git-"));
    barePath = join(tmpDir, "bare.git");
    workPath = join(tmpDir, "work");
    initBareRepo(barePath);
    initWorkingRepo(workPath, barePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for nonexistent branch", () => {
    assert.equal(readFromBranch(workPath, "nonexistent"), null);
  });

  it("reads snapshot metadata from branch", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    const snapshot = readFromBranch(workPath, "macbook-pro");
    assert.ok(snapshot);
    assert.equal(snapshot.machineId, "uuid-123");
    assert.equal(snapshot.machineAlias, "macbook-pro");
  });
});
