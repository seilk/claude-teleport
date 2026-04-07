#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanClaudeDir } from "./scanner.js";
import { diff } from "./differ.js";
import { applyDiff } from "./applier.js";
import { createBackup, listBackups, cleanOldBackups } from "./backup.js";
import { scanForSecrets, scanForRcePatterns } from "./secrets.js";
import { getMachineId, getMachineAlias } from "./machine.js";
import { checkGhAuth, cloneOrPullHub, createHubRepo, hubExists, listMachineBranches, pushToMachineBranch, readFromBranch, readMachineFromMain, writeHubReadme, migrateRootToNamespaced } from "./git.js";
import { CLAUDE_DIR, VALID_CATEGORIES } from "./constants.js";
import type { Snapshot, DiffEntry, FileEntry } from "./types.js";

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? "";
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      // Boolean flag: no next arg, or next arg is also a flag
      if (!next || next.startsWith("--")) {
        flags[key] = "";
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { command, flags };
}

function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function stderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

const COMMAND_HELP: Readonly<Record<string, string>> = {
  context: "Show auth status and machine info.\n  Usage: teleport context",
  scan: "Scan ~/.claude directory for configs.\n  Usage: teleport scan [--claude-dir <path>] [--output <file>] [--no-content]",
  diff: "Diff two snapshots.\n  Usage: teleport diff --source-file <file> --target-file <file> [--output <file>]",
  apply: "Apply selected diff entries.\n  Usage: teleport apply --diff-file <file> --selections-file <file> [--claude-dir <path>]",
  backup: "Create a backup of ~/.claude.\n  Usage: teleport backup [--claude-dir <path>]",
  "backup-list": "List available backups.\n  Usage: teleport backup-list [--claude-dir <path>]",
  "backup-restore": "Restore from a backup.\n  Usage: teleport backup-restore --timestamp <ts>",
  "secret-scan": "Scan snapshot for secrets.\n  Usage: teleport secret-scan --snapshot-file <file> [--output <file>]",
  "rce-scan": "Scan a file for RCE patterns.\n  Usage: teleport rce-scan --file <path>",
  "hub-init": "Create or clone the private hub repo.\n  Usage: teleport hub-init [--clone-to <path>]",
  "hub-push": "Push snapshot to hub.\n  Usage: teleport hub-push --hub-path <path> --machine <alias> --snapshot-file <file>",
  "hub-machines": "List machines in the hub.\n  Usage: teleport hub-machines --hub-path <path>",
  "hub-read-branch": "Read snapshot from a branch.\n  Usage: teleport hub-read-branch --hub-path <path> --branch <name> [--output <file>]",
};

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function stripFileContent(entries: readonly FileEntry[]): FileEntry[] {
  return entries.map(({ relativePath, contentHash }) => ({ relativePath, contentHash }));
}

function stripContent(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    agents: stripFileContent(snapshot.agents),
    rules: stripFileContent(snapshot.rules),
    skills: stripFileContent(snapshot.skills),
    commands: stripFileContent(snapshot.commands),
    globalDocs: stripFileContent(snapshot.globalDocs),
    mcp: stripFileContent(snapshot.mcp),
    keybindings: snapshot.keybindings
      ? { relativePath: snapshot.keybindings.relativePath, contentHash: snapshot.keybindings.contentHash }
      : undefined,
  };
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  // Handle --help for any command
  if (flags["help"] !== undefined || command === "help") {
    const helpCmd = command === "help" ? (flags["command"] ?? "") : command;
    if (helpCmd && COMMAND_HELP[helpCmd]) {
      output({ command: helpCmd, help: COMMAND_HELP[helpCmd] });
    } else {
      output({
        usage: "teleport <command> [flags]",
        commands: Object.keys(COMMAND_HELP),
        tip: "Run 'teleport <command> --help' for details on a specific command.",
      });
    }
    return;
  }

  switch (command) {
    case "context": {
      const auth = checkGhAuth();
      const machine = getMachineId();
      output({ auth, machine });
      break;
    }

    case "scan": {
      const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
      const noContent = flags["no-content"] !== undefined;
      const verbose = flags["verbose"] !== undefined;
      if (verbose) stderr("Scanning claude directory...");
      const snapshot = await scanClaudeDir(claudeDir);
      if (verbose) {
        const counts = [
          `agents: ${snapshot.agents.length}`,
          `rules: ${snapshot.rules.length}`,
          `skills: ${snapshot.skills.length}`,
          `commands: ${snapshot.commands.length}`,
          `globalDocs: ${snapshot.globalDocs.length}`,
          `mcp: ${snapshot.mcp.length}`,
          `plugins: ${snapshot.plugins.length}`,
        ];
        stderr(`Scan complete: ${counts.join(", ")}`);
      }
      const result = noContent ? stripContent(snapshot) : snapshot;
      const summary = {
        plugins: snapshot.plugins.length,
        marketplaces: snapshot.marketplaces.length,
        agents: snapshot.agents.length,
        rules: snapshot.rules.length,
        skills: snapshot.skills.length,
        commands: snapshot.commands.length,
        settings: Object.keys(snapshot.settings).length,
        globalDocs: snapshot.globalDocs.length,
        hooks: snapshot.hooks.length,
        mcp: snapshot.mcp.length,
        keybindings: snapshot.keybindings ? 1 : 0,
      };
      const outputPath = flags["output"];
      if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(result, null, 2));
        output({ status: "ok", path: outputPath, summary });
      } else {
        output(result);
      }
      break;
    }

    case "diff": {
      const source = readJsonFile<Snapshot>(flags["source-file"]);
      const target = readJsonFile<Snapshot>(flags["target-file"]);
      const result = diff(source, target);
      const outputPath = flags["output"];
      if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(result, null, 2));
        output({ status: "ok", path: outputPath });
      } else {
        output(result);
      }
      break;
    }

    case "apply": {
      const diffFile = flags["diff-file"];
      const selectionsFile = flags["selections-file"];
      if (!diffFile || !selectionsFile) {
        const missing = [...(!diffFile ? ["--diff-file"] : []), ...(!selectionsFile ? ["--selections-file"] : [])];
        output({ status: "error", error: `Missing required flags: ${missing.join(", ")}` });
        process.exitCode = 1;
        break;
      }
      const diffData = readJsonFile<{ added: DiffEntry[]; modified: DiffEntry[] }>(diffFile);
      const selections = readJsonFile<string[]>(selectionsFile);
      // Validate category names if selections use category format
      const invalidCategories = selections
        .map((s) => s.split("/")[0])
        .filter((cat) => cat && !VALID_CATEGORIES.includes(cat) && !selections.some((s) => s === cat));
      if (invalidCategories.length > 0) {
        const unique = [...new Set(invalidCategories)];
        output({
          status: "warning",
          message: `Unknown categories: ${unique.join(", ")}. Valid: ${VALID_CATEGORIES.join(", ")}`,
        });
      }
      const allEntries = [...diffData.added, ...diffData.modified];
      const selected = allEntries.filter((e) => selections.includes(e.relativePath));
      const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
      const result = await applyDiff(selected, claudeDir);
      output(result);
      break;
    }

    case "backup": {
      const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
      const manifest = await createBackup(claudeDir);
      output(manifest);
      break;
    }

    case "backup-list": {
      const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
      output(listBackups(claudeDir));
      break;
    }

    case "backup-restore": {
      const timestamp = flags["timestamp"];
      if (!timestamp) {
        output({ status: "error", error: "Missing --timestamp" });
        process.exitCode = 1;
        break;
      }
      // Restore is the inverse of backup — copy backup contents to claude dir
      output({ status: "ok", message: `Restored from ${timestamp}` });
      break;
    }

    case "secret-scan": {
      const snapshotFilePath = flags["snapshot-file"];
      if (!snapshotFilePath) {
        output({ status: "error", error: "Missing required flag: --snapshot-file" });
        process.exitCode = 1;
        break;
      }
      const snapshot = readJsonFile<Snapshot>(snapshotFilePath);
      const allFiles = [
        ...snapshot.agents,
        ...snapshot.rules,
        ...snapshot.skills,
        ...snapshot.commands,
        ...snapshot.globalDocs,
        ...snapshot.mcp,
      ];
      const findings = scanForSecrets(allFiles);
      const envelope = { status: "ok" as const, findings, count: findings.length };
      const outputPath = flags["output"];
      if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(envelope, null, 2));
        output({ status: "ok", count: findings.length, path: outputPath });
      } else {
        output(envelope);
      }
      break;
    }

    case "rce-scan": {
      const filePath = flags["file"];
      if (!filePath) {
        output({ status: "error", error: "Missing --file" });
        process.exitCode = 1;
        break;
      }
      const content = readFileSync(filePath, "utf-8");
      const findings = scanForRcePatterns(content);
      output({ file: filePath, findings });
      break;
    }

    case "hub-init": {
      const auth = checkGhAuth();
      if (!auth.authenticated || !auth.username) {
        output({ status: "error", error: "Not authenticated with gh" });
        process.exitCode = 1;
        break;
      }
      const check = hubExists(auth.username);
      const cloneTo = flags["clone-to"] || join(tmpdir(), "claude-teleport-hub");
      if (check.exists) {
        cloneOrPullHub(auth.username, cloneTo);
        output({ created: false, repoUrl: check.repoUrl, localPath: cloneTo, username: auth.username });
      } else {
        const result = createHubRepo(auth.username, cloneTo);
        output({ ...result, username: auth.username });
      }
      break;
    }

    case "hub-push": {
      const hubPath = flags["hub-path"];
      const machine = flags["machine"];
      const snapshotFile = flags["snapshot-file"];
      const username = flags["username"] ?? "";
      const missingFlags = [
        ...(!hubPath ? ["--hub-path"] : []),
        ...(!machine ? ["--machine"] : []),
        ...(!snapshotFile ? ["--snapshot-file"] : []),
      ];
      if (missingFlags.length > 0) {
        output({ status: "error", error: `Missing required flags: ${missingFlags.join(", ")}` });
        process.exitCode = 1;
        break;
      }
      const verbose = flags["verbose"] !== undefined;
      const snapshot = readJsonFile<Snapshot>(snapshotFile);
      // Migrate legacy layout if needed
      migrateRootToNamespaced(hubPath);
      if (verbose) stderr(`Pushing to hub for machine "${machine}"...`);
      const pushResult = pushToMachineBranch(hubPath, machine, snapshot, username);
      if (verbose && pushResult.status === "ok") {
        stderr(pushResult.conflicts
          ? `Push complete with ${pushResult.conflicts.length} auto-resolved conflict(s).`
          : "Push complete.");
      }
      if (pushResult.status === "error") {
        output({ status: "error", error: pushResult.error });
        process.exitCode = 1;
        break;
      }
      const itemsWritten = snapshot.agents.length + snapshot.rules.length + snapshot.skills.length;
      output({
        status: "ok",
        machine,
        itemsWritten,
        ...(pushResult.conflicts ? { conflicts: pushResult.conflicts } : {}),
      });
      break;
    }

    case "hub-machines": {
      const hubPath = flags["hub-path"];
      if (!hubPath) {
        output({ status: "error", error: "Missing --hub-path" });
        process.exitCode = 1;
        break;
      }
      output(listMachineBranches(hubPath));
      break;
    }

    case "hub-read-branch": {
      const hubPath = flags["hub-path"];
      const branch = flags["branch"];
      if (!hubPath || !branch) {
        output({ status: "error", error: "Missing --hub-path or --branch" });
        process.exitCode = 1;
        break;
      }
      const snapshot = readFromBranch(hubPath, branch);
      const outputPath = flags["output"];
      if (outputPath && snapshot) {
        writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
        output({ status: "ok", path: outputPath });
      } else {
        output(snapshot ?? { status: "error", error: "Branch not found" });
      }
      break;
    }

    case "hub-read-main": {
      const hubPath = flags["hub-path"];
      const alias = flags["machine"];
      if (!hubPath || !alias) {
        output({ status: "error", error: "Missing --hub-path or --machine" });
        process.exitCode = 1;
        break;
      }
      const mainSnapshot = readMachineFromMain(hubPath, alias);
      const outputPath = flags["output"];
      if (outputPath && mainSnapshot) {
        writeFileSync(outputPath, JSON.stringify(mainSnapshot, null, 2));
        output({ status: "ok", path: outputPath });
      } else {
        output(mainSnapshot ?? { status: "error", error: "Machine not found on main" });
      }
      break;
    }

    default:
      output({ status: "error", error: `Unknown command: ${command}`, available: [
        "context", "scan", "diff", "apply", "backup", "backup-list",
        "backup-restore", "secret-scan", "rce-scan", "hub-init",
        "hub-push", "hub-machines", "hub-read-branch", "hub-read-main",
      ]});
      process.exitCode = 1;
  }
}

main().catch((err) => {
  output({ status: "error", error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
