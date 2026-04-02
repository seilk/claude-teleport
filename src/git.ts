import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { platform } from "node:os";
import { createHash } from "node:crypto";
import { PRIVATE_REPO_NAME, PUBLIC_REPO_NAME, TELEPORT_VERSION, CATEGORY_PATHS, GLOBAL_DOC_FILES } from "./constants.js";
import type { Snapshot, FileEntry, PluginEntry, Marketplace, HookEntry } from "./types.js";

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

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, { encoding: "utf-8", cwd, timeout: 30000 }).trim();
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
  exec(`gh repo create ${username}/${PRIVATE_REPO_NAME} --private --confirm`);
  return { created: true, repoUrl, localPath: "" };
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

function writeSnapshotYaml(snapshot: Snapshot, repoPath: string, machinePrefix: string): void {
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
  const targetDir = join(repoPath, machinePrefix);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, "snapshot.yaml"), yaml);
}

function writeConfigFiles(snapshot: Snapshot, repoPath: string, machinePrefix: string): void {
  const base = join(repoPath, machinePrefix);
  const fileCategories = ["agents", "rules", "skills", "commands", "globalDocs", "mcp"] as const;
  for (const cat of fileCategories) {
    const entries = snapshot[cat] as readonly FileEntry[];
    for (const entry of entries) {
      if (entry.content) {
        const targetPath = join(base, entry.relativePath);
        mkdirSync(join(targetPath, ".."), { recursive: true });
        writeFileSync(targetPath, entry.content);
      }
    }
  }

  if (Object.keys(snapshot.settings).length > 0) {
    writeFileSync(join(base, "settings.json"), JSON.stringify(snapshot.settings, null, 2));
  }

  if (snapshot.plugins.length > 0) {
    mkdirSync(join(base, "plugins"), { recursive: true });
    writeFileSync(join(base, "plugins", "installed_plugins.json"), JSON.stringify(snapshot.plugins, null, 2));
  }
  if (snapshot.marketplaces.length > 0) {
    mkdirSync(join(base, "plugins"), { recursive: true });
    writeFileSync(join(base, "plugins", "known_marketplaces.json"), JSON.stringify(snapshot.marketplaces, null, 2));
  }
}

function writeRegistryYaml(repoPath: string): void {
  const machinesDir = join(repoPath, "machines");
  if (!existsSync(machinesDir)) return;

  const machineDirs = readdirSync(machinesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const entries: string[] = [];
  for (const alias of machineDirs) {
    const yamlPath = join(machinesDir, alias, "snapshot.yaml");
    if (!existsSync(yamlPath)) continue;
    const content = readFileSync(yamlPath, "utf-8");
    const idMatch = content.match(/machineId:\s*(.+)/);
    const pushMatch = content.match(/lastPush:\s*(.+)/);
    const agentsMatch = content.match(/agents:\s*(\d+)/);
    const rulesMatch = content.match(/rules:\s*(\d+)/);
    const skillsMatch = content.match(/skills:\s*(\d+)/);
    const commandsMatch = content.match(/commands:\s*(\d+)/);
    const pluginsMatch = content.match(/plugins:\s*(\d+)/);
    const hooksMatch = content.match(/hooks:\s*(\d+)/);
    entries.push([
      `  ${alias}:`,
      `    id: "${idMatch?.[1] ?? ""}"`,
      `    alias: "${alias}"`,
      `    lastPush: "${pushMatch?.[1] ?? ""}"`,
      `    counts:`,
      `      agents: ${agentsMatch?.[1] ?? "0"}`,
      `      rules: ${rulesMatch?.[1] ?? "0"}`,
      `      skills: ${skillsMatch?.[1] ?? "0"}`,
      `      commands: ${commandsMatch?.[1] ?? "0"}`,
      `      plugins: ${pluginsMatch?.[1] ?? "0"}`,
      `      hooks: ${hooksMatch?.[1] ?? "0"}`,
    ].join("\n"));
  }

  const yaml = [
    `teleportVersion: "${TELEPORT_VERSION}"`,
    `lastUpdated: "${new Date().toISOString()}"`,
    `machines:`,
    ...entries,
  ].join("\n");
  writeFileSync(join(repoPath, "registry.yaml"), yaml);
}

function generateHubReadme(username: string, isPublic: boolean): string {
  const title = isPublic
    ? `# Teleport Public — ${username}'s Shared Claude Code Configs`
    : `# Teleport Hub — ${username}'s Claude Code Configurations`;

  const intro = isPublic
    ? `This repository contains curated Claude Code configurations shared by **${username}**.\nManaged by [Teleport](https://github.com/seilk/claude-teleport), a Claude Code plugin for syncing environments across machines.`
    : `This repository is managed by [Teleport](https://github.com/seilk/claude-teleport),\na Claude Code plugin that syncs your development environment across machines.`;

  const lines = [
    title,
    "",
    intro,
    "",
    "## Repository Structure",
    "",
    "- `registry.yaml` — Machine index with metadata (counts, last push time)",
    "- `machines/{alias}/` — Per-machine configuration snapshots",
    "  - `snapshot.yaml` — Machine metadata (id, alias, timestamps, counts)",
    "  - `agents/` — Claude Code agent definitions",
    "  - `rules/` — Coding standards and language-specific rules",
    "  - `skills/` — SKILL.md files and supporting resources",
    "  - `commands/` — Custom command definitions",
    "  - `mcp-configs/` — MCP server configurations",
    "  - `plugins/` — Plugin and marketplace metadata",
    "  - `settings.json` — Claude Code settings (credentials excluded)",
    "  - `CLAUDE.md` / `AGENTS.md` — Global instruction files",
    "",
    "## Branches",
    "",
    "- `main` — Merged union of all machines with `registry.yaml`",
    "- `{machine-alias}` — Individual machine snapshots",
    "",
    "## For AI Agents",
    "",
    "When reading this repository:",
    "1. Start with `registry.yaml` to see available machines and their config counts",
    "2. Browse `machines/{alias}/snapshot.yaml` for per-machine metadata",
    "3. File paths inside `machines/{alias}/` map directly to `~/.claude/` on that machine",
    "4. Settings have credentials stripped — never contain secrets",
  ];

  if (isPublic) {
    lines.push(
      "",
      "## Importing These Configs",
      "",
      "To import configs from this repository into your Claude Code environment:",
      `1. Run \`/teleport-from ${username}\` in Claude Code`,
      "2. Select which machine's configs to browse",
      "3. Review each file before applying (mandatory for safety)",
      "",
      "All files have been double secret-scanned, but always review before applying.",
    );
  } else {
    lines.push(
      "",
      "## Commands",
      "",
      "- `/teleport-push` — Push local configs to this hub",
      "- `/teleport-pull` — Pull configs from this hub to local machine",
    );
  }

  return lines.join("\n") + "\n";
}

export function writeHubReadme(repoPath: string, username: string, isPublic: boolean = false): void {
  writeFileSync(join(repoPath, "README.md"), generateHubReadme(username, isPublic));
}

export function pushToMachineBranch(
  repoPath: string,
  machineAlias: string,
  snapshot: Snapshot,
  username: string = "",
): void {
  const machinePrefix = `machines/${machineAlias}`;

  // Create or switch to machine branch
  try {
    exec(`git checkout ${machineAlias}`, repoPath);
  } catch {
    exec(`git checkout -b ${machineAlias}`, repoPath);
  }

  // Write configs under machines/{alias}/
  writeSnapshotYaml(snapshot, repoPath, machinePrefix);
  writeConfigFiles(snapshot, repoPath, machinePrefix);
  if (username) {
    writeHubReadme(repoPath, username);
  }

  // Commit and push machine branch
  exec("git add -A", repoPath);
  try {
    exec(`git commit -m "teleport: update ${machineAlias}"`, repoPath);
  } catch {
    // Nothing to commit
  }

  // Merge into main
  exec("git checkout main", repoPath);
  try {
    exec(`git merge ${machineAlias} -X theirs --no-ff -m "merge ${machineAlias} into main"`, repoPath);
  } catch {
    // Merge conflict — force theirs strategy
    exec("git add -A", repoPath);
    exec(`git commit -m "merge ${machineAlias} into main (resolved)"`, repoPath);
  }

  // Update registry and readme on main
  writeRegistryYaml(repoPath);
  if (username) {
    writeHubReadme(repoPath, username);
  }
  exec("git add -A", repoPath);
  try {
    exec(`git commit -m "teleport: update registry"`, repoPath);
  } catch {
    // Nothing changed
  }
}

export function listMachineBranches(repoPath: string): MachineInfo[] {
  // Try registry.yaml on main first (fast path, no branch checkout)
  const registryPath = join(repoPath, "registry.yaml");
  if (existsSync(registryPath)) {
    const content = readFileSync(registryPath, "utf-8");
    const machines: MachineInfo[] = [];
    const machineBlocks = content.split(/\n  (?=\S+:$)/m);
    for (const block of machineBlocks) {
      const aliasMatch = block.match(/^\s*alias:\s*"(.+)"/m);
      const idMatch = block.match(/^\s*id:\s*"(.+)"/m);
      const pushMatch = block.match(/^\s*lastPush:\s*"(.+)"/m);
      if (aliasMatch) {
        machines.push({
          alias: aliasMatch[1],
          id: idMatch?.[1] ?? "",
          lastPush: pushMatch?.[1] ?? "",
        });
      }
    }
    if (machines.length > 0) return machines;
  }

  // Fallback: scan machines/ directory on main
  const machinesDir = join(repoPath, "machines");
  if (existsSync(machinesDir)) {
    const machines: MachineInfo[] = [];
    const dirs = readdirSync(machinesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const alias of dirs) {
      const yamlPath = join(machinesDir, alias, "snapshot.yaml");
      let id = "";
      let lastPush = "";
      if (existsSync(yamlPath)) {
        const content = readFileSync(yamlPath, "utf-8");
        const idMatch = content.match(/machineId:\s*(.+)/);
        const pushMatch = content.match(/lastPush:\s*(.+)/);
        id = idMatch?.[1] ?? "";
        lastPush = pushMatch?.[1] ?? "";
      }
      machines.push({ alias, id, lastPush });
    }
    return machines;
  }

  // Legacy fallback: iterate branches
  const branchOutput = exec("git branch --list", repoPath);
  const branches = branchOutput
    .split("\n")
    .map((b) => b.replace("*", "").trim())
    .filter((b) => b && b !== "main");

  const machines: MachineInfo[] = [];
  const currentBranch = exec("git branch --show-current", repoPath);

  for (const branch of branches) {
    exec(`git checkout ${branch}`, repoPath);
    const yamlPath = join(repoPath, "machines", branch, "snapshot.yaml");
    const legacyYaml = join(repoPath, "snapshot.yaml");
    const targetYaml = existsSync(yamlPath) ? yamlPath : legacyYaml;
    let id = "";
    let lastPush = "";
    if (existsSync(targetYaml)) {
      const content = readFileSync(targetYaml, "utf-8");
      const idMatch = content.match(/machineId:\s*(.+)/);
      const pushMatch = content.match(/lastPush:\s*(.+)/);
      id = idMatch?.[1] ?? "";
      lastPush = pushMatch?.[1] ?? "";
    }
    machines.push({ alias: branch, id, lastPush });
  }

  exec(`git checkout ${currentBranch || "main"}`, repoPath);
  return machines;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isTextFile(filePath: string): boolean {
  try {
    const buf = readFileSync(filePath);
    for (let i = 0; i < Math.min(buf.length, 8000); i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function scanDirToFileEntries(baseDir: string, dirPath: string, category: string): FileEntry[] {
  const fullPath = join(baseDir, dirPath);
  if (!existsSync(fullPath)) return [];

  const entries: FileEntry[] = [];
  function walk(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const itemPath = join(dir, item.name);
      if (item.isDirectory()) {
        walk(itemPath);
      } else if (item.isFile() && isTextFile(itemPath)) {
        const content = readFileSync(itemPath, "utf-8");
        entries.push({
          relativePath: join(category, relative(fullPath, itemPath)),
          contentHash: hashContent(content),
          content,
        });
      }
    }
  }
  walk(fullPath);
  return entries;
}

function readSnapshotFromDir(machineDir: string, branchName: string): Snapshot | null {
  const yamlPath = join(machineDir, "snapshot.yaml");
  if (!existsSync(yamlPath)) return null;

  const yaml = readFileSync(yamlPath, "utf-8");
  const idMatch = yaml.match(/machineId:\s*(.+)/);
  const aliasMatch = yaml.match(/machineAlias:\s*(.+)/);

  // Read file categories
  const agents = scanDirToFileEntries(machineDir, CATEGORY_PATHS.agents, "agents");
  const rules = scanDirToFileEntries(machineDir, CATEGORY_PATHS.rules, "rules");
  const skills = scanDirToFileEntries(machineDir, CATEGORY_PATHS.skills, "skills");
  const commands = scanDirToFileEntries(machineDir, CATEGORY_PATHS.commands, "commands");
  const mcp = scanDirToFileEntries(machineDir, CATEGORY_PATHS.mcp, "mcp-configs");

  // Read global docs
  const globalDocs: FileEntry[] = [];
  for (const docFile of GLOBAL_DOC_FILES) {
    const docPath = join(machineDir, docFile);
    if (existsSync(docPath)) {
      const content = readFileSync(docPath, "utf-8");
      globalDocs.push({ relativePath: docFile, contentHash: hashContent(content), content });
    }
  }

  // Read settings
  let settings: Record<string, unknown> = {};
  const settingsPath = join(machineDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Invalid JSON — skip
    }
  }

  // Read plugins and marketplaces
  let plugins: PluginEntry[] = [];
  let marketplaces: Marketplace[] = [];
  const pluginsPath = join(machineDir, "plugins", "installed_plugins.json");
  if (existsSync(pluginsPath)) {
    try { plugins = JSON.parse(readFileSync(pluginsPath, "utf-8")); } catch { /* skip */ }
  }
  const marketPath = join(machineDir, "plugins", "known_marketplaces.json");
  if (existsSync(marketPath)) {
    try { marketplaces = JSON.parse(readFileSync(marketPath, "utf-8")); } catch { /* skip */ }
  }

  // Read hooks
  const hooks: HookEntry[] = [];

  return {
    teleportVersion: TELEPORT_VERSION,
    machineId: idMatch?.[1] ?? "",
    machineAlias: aliasMatch?.[1] ?? branchName,
    plugins,
    marketplaces,
    agents,
    rules,
    skills,
    commands,
    settings,
    globalDocs,
    hooks,
    mcp,
  };
}

export function readFromBranch(repoPath: string, branchName: string): Snapshot | null {
  try {
    exec(`git checkout ${branchName}`, repoPath);
  } catch {
    return null;
  }

  const machineDir = join(repoPath, "machines", branchName);
  if (!existsSync(machineDir)) {
    // Legacy: try repo root
    const legacyYaml = join(repoPath, "snapshot.yaml");
    if (!existsSync(legacyYaml)) {
      exec("git checkout main", repoPath);
      return null;
    }
    const snapshot = readSnapshotFromDir(repoPath, branchName);
    exec("git checkout main", repoPath);
    return snapshot;
  }

  const snapshot = readSnapshotFromDir(machineDir, branchName);
  exec("git checkout main", repoPath);
  return snapshot;
}

export function readMachineFromMain(repoPath: string, alias: string): Snapshot | null {
  const machineDir = join(repoPath, "machines", alias);
  if (!existsSync(machineDir)) return null;
  return readSnapshotFromDir(machineDir, alias);
}

export function migrateRootToNamespaced(repoPath: string): boolean {
  const rootSnapshot = join(repoPath, "snapshot.yaml");
  const machinesDir = join(repoPath, "machines");
  if (!existsSync(rootSnapshot) || existsSync(machinesDir)) return false;

  // Remove root-level config files (they'll be re-pushed under machines/)
  const dirsToRemove = ["agents", "rules", "skills", "commands", "mcp-configs", "plugins"];
  const filesToRemove = ["snapshot.yaml", "settings.json", "CLAUDE.md", "AGENTS.md"];
  for (const dir of dirsToRemove) {
    const p = join(repoPath, dir);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }
  for (const f of filesToRemove) {
    const p = join(repoPath, f);
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  }

  exec("git add -A", repoPath);
  try {
    exec(`git commit -m "teleport: migrate to namespaced layout"`, repoPath);
  } catch {
    // Nothing to commit
  }
  return true;
}

export function createPublicRepo(username: string): string {
  try {
    exec(`gh repo view ${username}/${PUBLIC_REPO_NAME} --json url`);
    return `https://github.com/${username}/${PUBLIC_REPO_NAME}`;
  } catch {
    exec(`gh repo create ${username}/${PUBLIC_REPO_NAME} --public --confirm`);
    return `https://github.com/${username}/${PUBLIC_REPO_NAME}`;
  }
}
