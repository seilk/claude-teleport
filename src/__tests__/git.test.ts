import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pushToMachineBranch, listMachineBranches, readFromBranch, readMachineFromMain, pushToPublicRepo, readMachineFromPublic } from "../git.js";
import type { Snapshot } from "../types.js";

function makeSnapshot(overrides?: Partial<Snapshot>): Snapshot {
  return {
    teleportVersion: "0.1.0",
    machineId: "uuid-123",
    machineAlias: "macbook-pro",
    plugins: [{ name: "superpowers", marketplace: "official" }],
    marketplaces: [{ name: "official", source: { source: "github" as const, repo: "anthropics/claude-plugins" } }],
    agents: [{ relativePath: "agents/planner.md", contentHash: "abc", content: "# Planner" }],
    rules: [],
    skills: [],
    commands: [],
    settings: { theme: "dark" },
    globalDocs: [{ relativePath: "CLAUDE.md", contentHash: "def", content: "# Config" }],
    hooks: [],
    mcp: [],
    scripts: [],
    ...overrides,
  };
}

function initBareRepo(path: string): void {
  execSync(`git init --bare ${path}`, { encoding: "utf-8" });
  // Force "main" as default branch regardless of system git config
  execSync(`git symbolic-ref HEAD refs/heads/main`, { cwd: path, encoding: "utf-8" });
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

  it("creates a machine branch with namespaced config files", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());

    // Verify branch exists
    const branches = execSync("git branch --list", { cwd: workPath, encoding: "utf-8" });
    assert.ok(branches.includes("macbook-pro"));

    // Switch to branch and verify files under machines/{alias}/
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "snapshot.yaml")));
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md")));
    assert.equal(readFileSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md"), "utf-8"), "# Planner");
  });

  it("writes snapshot.yaml with metadata under machines/", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    const yaml = readFileSync(join(workPath, "machines", "macbook-pro", "snapshot.yaml"), "utf-8");
    assert.ok(yaml.includes("machineId: uuid-123"));
    assert.ok(yaml.includes("machineAlias: macbook-pro"));
    assert.ok(yaml.includes("agents: 1"));
  });

  it("writes settings.json under machines/", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    const settings = JSON.parse(readFileSync(join(workPath, "machines", "macbook-pro", "settings.json"), "utf-8"));
    assert.equal(settings.theme, "dark");
  });

  it("writes plugin and marketplace metadata under machines/", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    execSync("git checkout macbook-pro", { cwd: workPath, encoding: "utf-8" });
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "plugins", "installed_plugins.json")));
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "plugins", "known_marketplaces.json")));
  });

  it("merges machine branch into main with namespaced paths", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());

    // Verify we're back on main
    const current = execSync("git branch --show-current", { cwd: workPath, encoding: "utf-8" }).trim();
    assert.equal(current, "main");

    // Verify main has namespaced files
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md")));
    // Verify registry.yaml exists on main
    assert.ok(existsSync(join(workPath, "registry.yaml")));
  });

  it("handles multiple machines in separate namespaced directories", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot({ machineId: "uuid-111", machineAlias: "macbook-pro" }));
    pushToMachineBranch(workPath, "work-imac", makeSnapshot({
      machineId: "uuid-222",
      machineAlias: "work-imac",
      agents: [{ relativePath: "agents/reviewer.md", contentHash: "xyz", content: "# Reviewer" }],
    }));

    const branches = execSync("git branch --list", { cwd: workPath, encoding: "utf-8" });
    assert.ok(branches.includes("macbook-pro"));
    assert.ok(branches.includes("work-imac"));

    // Main should have BOTH machines in separate directories (no conflicts)
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md")));
    assert.ok(existsSync(join(workPath, "machines", "work-imac", "agents", "reviewer.md")));

    // Registry should list both machines
    const registry = readFileSync(join(workPath, "registry.yaml"), "utf-8");
    assert.ok(registry.includes("macbook-pro"));
    assert.ok(registry.includes("work-imac"));
  });

  it("generates README.md when username is provided", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot(), "testuser");

    // README should exist on main
    assert.ok(existsSync(join(workPath, "README.md")));
    const readme = readFileSync(join(workPath, "README.md"), "utf-8");
    assert.ok(readme.includes("testuser"));
    assert.ok(readme.includes("Teleport Hub"));
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

  it("reads full snapshot with content from branch", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    const snapshot = readFromBranch(workPath, "macbook-pro");
    assert.ok(snapshot);
    assert.equal(snapshot.machineId, "uuid-123");
    assert.equal(snapshot.machineAlias, "macbook-pro");
    // Full snapshot should have actual file content
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].relativePath, "agents/planner.md");
    assert.equal(snapshot.agents[0].content, "# Planner");
    assert.ok(snapshot.agents[0].contentHash);
    // Settings should be populated
    assert.equal((snapshot.settings as Record<string, unknown>).theme, "dark");
    // Global docs
    assert.equal(snapshot.globalDocs.length, 1);
    assert.equal(snapshot.globalDocs[0].relativePath, "CLAUDE.md");
  });
});

describe("readMachineFromMain", () => {
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

  it("returns null for nonexistent machine", () => {
    assert.equal(readMachineFromMain(workPath, "nonexistent"), null);
  });

  it("reads machine snapshot from main without branch checkout", () => {
    pushToMachineBranch(workPath, "macbook-pro", makeSnapshot());
    // We're on main after push
    const snapshot = readMachineFromMain(workPath, "macbook-pro");
    assert.ok(snapshot);
    assert.equal(snapshot.machineId, "uuid-123");
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].content, "# Planner");
  });
});

describe("pushToPublicRepo", () => {
  let tmpDir: string;
  let barePath: string;
  let workPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-git-pub-"));
    barePath = join(tmpDir, "bare.git");
    workPath = join(tmpDir, "work");
    initBareRepo(barePath);
    initWorkingRepo(workPath, barePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pushes configs under machines/ namespace to public repo", () => {
    const result = pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    assert.equal(result.status, "ok");

    // Verify files exist under machines/{alias}/
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "snapshot.yaml")));
    assert.ok(existsSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md")));
    assert.equal(
      readFileSync(join(workPath, "machines", "macbook-pro", "agents", "planner.md"), "utf-8"),
      "# Planner",
    );
  });

  it("generates registry.yaml on main", () => {
    pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    assert.ok(existsSync(join(workPath, "registry.yaml")));
    const registry = readFileSync(join(workPath, "registry.yaml"), "utf-8");
    assert.ok(registry.includes("macbook-pro"));
  });

  it("generates public README with import instructions", () => {
    pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    assert.ok(existsSync(join(workPath, "README.md")));
    const readme = readFileSync(join(workPath, "README.md"), "utf-8");
    assert.ok(readme.includes("testuser"));
    assert.ok(readme.includes("teleport-from"));
  });

  it("returns ok with no error when nothing to commit", () => {
    pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    // Push same snapshot again — nothing changed
    const result = pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    assert.equal(result.status, "ok");
  });
});

describe("readMachineFromPublic", () => {
  let tmpDir: string;
  let barePath: string;
  let workPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-git-pub-"));
    barePath = join(tmpDir, "bare.git");
    workPath = join(tmpDir, "work");
    initBareRepo(barePath);
    initWorkingRepo(workPath, barePath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for nonexistent machine", () => {
    assert.equal(readMachineFromPublic(workPath, "nonexistent"), null);
  });

  it("reads machine snapshot from public repo", () => {
    pushToPublicRepo(workPath, "macbook-pro", makeSnapshot(), "testuser");
    const snapshot = readMachineFromPublic(workPath, "macbook-pro");
    assert.ok(snapshot);
    assert.equal(snapshot.machineId, "uuid-123");
    assert.equal(snapshot.machineAlias, "macbook-pro");
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0].content, "# Planner");
    assert.equal((snapshot.settings as Record<string, unknown>).theme, "dark");
  });
});
