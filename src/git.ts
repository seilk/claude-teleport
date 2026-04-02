import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";
import { PRIVATE_REPO_NAME, PUBLIC_REPO_NAME, TELEPORT_VERSION } from "./constants.js";
import type { Snapshot, FileEntry } from "./types.js";

export interface GhAuthStatus {
  readonly authenticated: boolean;
  readonly username?: string;
  readonly os: string;
  readonly ghInstalled: boolean;
}

export interface HubInitResult {
  readonly created: boolean;
  readonly repoUrl: string;
  readonly localPath: string;
}

export interface MachineInfo {
  readonly alias: string;
  readonly id: string;
  readonly lastPush: string;
}

const LOCAL_TIMEOUT = Number(process.env["TELEPORT_GIT_TIMEOUT"]) || 30_000;
const REMOTE_TIMEOUT = Number(process.env["TELEPORT_GIT_REMOTE_TIMEOUT"]) || 120_000;

function exec(cmd: string, cwd?: string): string {
  const isRemote = /\b(push|pull|fetch|clone)\b/.test(cmd);
  const timeout = isRemote ? REMOTE_TIMEOUT : LOCAL_TIMEOUT;
  return execSync(cmd, { encoding: "utf-8", cwd, timeout }).trim();
}

export function checkGhAuth(): GhAuthStatus {
  const os = platform();
  let ghInstalled = false;
  try {
    exec("gh --version");
    ghInstalled = true;
  } catch {
    return { authenticated: false, os, ghInstalled: false };
  }

  try {
    exec("gh auth status");
    const username = exec("gh api user -q .login");
    return { authenticated: true, username, os, ghInstalled };
  } catch {
    return { authenticated: false, os, ghInstalled };
  }
}

export function getGhUsername(): string {
  return exec("gh api user -q .login");
}

export function hubExists(username: string): { exists: boolean; repoUrl?: string } {
  try {
    exec(`gh repo view ${username}/${PRIVATE_REPO_NAME} --json url -q .url`);
    const repoUrl = `https://github.com/${username}/${PRIVATE_REPO_NAME}`;
    return { exists: true, repoUrl };
  } catch {
    return { exists: false };
  }
}

export function createHubRepo(username: string): HubInitResult {
  const check = hubExists(username);
  if (check.exists) {
    return { created: false, repoUrl: check.repoUrl!, localPath: "" };
  }

  const repoUrl = `https://github.com/${username}/${PRIVATE_REPO_NAME}`;
  exec(`gh repo create ${username}/${PRIVATE_REPO_NAME} --private`);

  // Clone and create initial commit on main so hub-push can merge into it
  const tmpDir = join(tmpdir(), `teleport-hub-${Date.now()}`);
  exec(`git clone ${repoUrl}.git ${tmpDir}`);
  writeFileSync(join(tmpDir, "README.md"), `# Claude Teleport Hub\n\nPrivate hub for syncing Claude Code configs across machines.\n`);
  exec("git add -A", tmpDir);
  exec('git commit -m "init: create hub repository"', tmpDir);
  exec("git push -u origin main", tmpDir);

  return { created: true, repoUrl, localPath: tmpDir };
}

export function cloneOrPullHub(username: string, localPath: string): void {
  if (existsSync(join(localPath, ".git"))) {
    exec("git pull --rebase", localPath);
  } else {
    mkdirSync(localPath, { recursive: true });
    exec(`git clone https://github.com/${username}/${PRIVATE_REPO_NAME}.git ${localPath}`);
  }
}

export function pushToHub(localPath: string, message: string): void {
  exec("git add -A", localPath);
  try {
    exec(`git commit -m "${message}"`, localPath);
  } catch {
    return;
  }
  exec("git push", localPath);
}

// --- Branch-based operations ---

function writeSnapshotYaml(snapshot: Snapshot, repoPath: string): void {
  const yaml = [
    `teleportVersion: ${TELEPORT_VERSION}`,
    `machineId: ${snapshot.machineId}`,
    `machineAlias: ${snapshot.machineAlias}`,
    `lastPush: ${new Date().toISOString()}`,
    `agents: ${snapshot.agents.length}`,
    `rules: ${snapshot.rules.length}`,
    `skills: ${snapshot.skills.length}`,
    `commands: ${snapshot.commands.length}`,
    `plugins: ${snapshot.plugins.length}`,
    `hooks: ${snapshot.hooks.length}`,
  ].join("\n");
  writeFileSync(join(repoPath, "snapshot.yaml"), yaml);
}

function writeConfigFiles(snapshot: Snapshot, repoPath: string): void {
  const fileCategories = ["agents", "rules", "skills", "commands", "globalDocs", "mcp"] as const;
  for (const cat of fileCategories) {
    const entries = snapshot[cat] as readonly FileEntry[];
    for (const entry of entries) {
      if (entry.content) {
        const targetPath = join(repoPath, entry.relativePath);
        mkdirSync(join(targetPath, ".."), { recursive: true });
        writeFileSync(targetPath, entry.content);
      }
    }
  }

  if (Object.keys(snapshot.settings).length > 0) {
    writeFileSync(join(repoPath, "settings.json"), JSON.stringify(snapshot.settings, null, 2));
  }

  if (snapshot.plugins.length > 0) {
    mkdirSync(join(repoPath, "plugins"), { recursive: true });
    writeFileSync(join(repoPath, "plugins", "installed_plugins.json"), JSON.stringify(snapshot.plugins, null, 2));
  }
  if (snapshot.marketplaces.length > 0) {
    mkdirSync(join(repoPath, "plugins"), { recursive: true });
    writeFileSync(join(repoPath, "plugins", "known_marketplaces.json"), JSON.stringify(snapshot.marketplaces, null, 2));
  }
}

export interface PushResult {
  readonly status: "ok" | "error";
  readonly conflicts?: readonly string[];
  readonly error?: string;
}

export function pushToMachineBranch(
  repoPath: string,
  machineAlias: string,
  snapshot: Snapshot,
): PushResult {
  // Record original state for rollback
  let originalHead: string;
  let originalBranch: string;
  try {
    originalHead = exec("git rev-parse HEAD", repoPath);
    originalBranch = exec("git branch --show-current", repoPath) || "main";
  } catch {
    // Empty repo — no HEAD yet
    originalHead = "";
    originalBranch = "main";
  }

  try {
    // Create or switch to machine branch
    try {
      exec(`git checkout ${machineAlias}`, repoPath);
    } catch {
      exec(`git checkout -b ${machineAlias}`, repoPath);
    }

    // Write configs to repo root
    writeSnapshotYaml(snapshot, repoPath);
    writeConfigFiles(snapshot, repoPath);

    // Commit and push machine branch
    exec("git add -A", repoPath);
    try {
      exec(`git commit -m "teleport: update ${machineAlias}"`, repoPath);
    } catch {
      // Nothing to commit
    }

    // Merge into main — first try without force strategy to detect conflicts
    exec("git checkout main", repoPath);
    let conflicts: string[] = [];
    try {
      exec(`git merge ${machineAlias} --no-ff -m "merge ${machineAlias} into main"`, repoPath);
    } catch {
      // Merge conflict detected — collect conflict file list
      try {
        const conflictOutput = exec("git diff --name-only --diff-filter=U", repoPath);
        conflicts = conflictOutput.split("\n").filter(Boolean);
      } catch {
        conflicts = ["(unable to list conflicted files)"];
      }
      // Auto-resolve with theirs strategy
      exec("git merge --abort", repoPath);
      exec(`git merge ${machineAlias} -X theirs --no-ff -m "merge ${machineAlias} into main (auto-resolved)"`, repoPath);
    }

    return conflicts.length > 0
      ? { status: "ok", conflicts }
      : { status: "ok" };
  } catch (err) {
    // Rollback to original state
    try {
      exec("git merge --abort", repoPath);
    } catch { /* no merge in progress */ }
    try {
      exec(`git checkout ${originalBranch}`, repoPath);
      if (originalHead) {
        exec(`git reset --hard ${originalHead}`, repoPath);
      }
    } catch { /* best effort rollback */ }

    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function listMachineBranches(repoPath: string): MachineInfo[] {
  const branchOutput = exec("git branch --list", repoPath);
  const branches = branchOutput
    .split("\n")
    .map((b) => b.replace("*", "").trim())
    .filter((b) => b && b !== "main");

  const machines: MachineInfo[] = [];
  const currentBranch = exec("git branch --show-current", repoPath);

  for (const branch of branches) {
    exec(`git checkout ${branch}`, repoPath);
    const yamlPath = join(repoPath, "snapshot.yaml");
    let id = "";
    let lastPush = "";
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, "utf-8");
      const idMatch = content.match(/machineId:\s*(.+)/);
      const pushMatch = content.match(/lastPush:\s*(.+)/);
      id = idMatch?.[1] ?? "";
      lastPush = pushMatch?.[1] ?? "";
    }
    machines.push({ alias: branch, id, lastPush });
  }

  // Return to original branch
  exec(`git checkout ${currentBranch || "main"}`, repoPath);
  return machines;
}

export function readFromBranch(repoPath: string, branchName: string): Snapshot | null {
  try {
    exec(`git checkout ${branchName}`, repoPath);
  } catch {
    return null;
  }

  const yamlPath = join(repoPath, "snapshot.yaml");
  if (!existsSync(yamlPath)) {
    exec("git checkout main", repoPath);
    return null;
  }

  const yaml = readFileSync(yamlPath, "utf-8");
  const idMatch = yaml.match(/machineId:\s*(.+)/);
  const aliasMatch = yaml.match(/machineAlias:\s*(.+)/);

  // Minimal snapshot from branch — full reading would use scanner on this directory
  const snapshot: Snapshot = {
    teleportVersion: TELEPORT_VERSION,
    machineId: idMatch?.[1] ?? "",
    machineAlias: aliasMatch?.[1] ?? branchName,
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
  };

  exec("git checkout main", repoPath);
  return snapshot;
}

export function createPublicRepo(username: string): string {
  try {
    exec(`gh repo view ${username}/${PUBLIC_REPO_NAME} --json url`);
    return `https://github.com/${username}/${PUBLIC_REPO_NAME}`;
  } catch {
    exec(`gh repo create ${username}/${PUBLIC_REPO_NAME} --public`);
    return `https://github.com/${username}/${PUBLIC_REPO_NAME}`;
  }
}
