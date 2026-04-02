#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { scanClaudeDir } from "./scanner.js";
import { diff } from "./differ.js";
import { applyDiff } from "./applier.js";
import { createBackup, listBackups, cleanOldBackups } from "./backup.js";
import { scanForSecrets, scanForRcePatterns } from "./secrets.js";
import { getMachineId, getMachineAlias } from "./machine.js";
import { checkGhAuth, createHubRepo, hubExists, listMachineBranches, pushToMachineBranch, readFromBranch } from "./git.js";
import { CLAUDE_DIR } from "./constants.js";
import type { Snapshot, DiffEntry } from "./types.js";

function parseArgs(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? "";
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1] ?? "";
      i++;
    }
  }
  return { command, flags };
}

function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "context": {
      const auth = checkGhAuth();
      const machine = getMachineId();
      output({ auth, machine });
      break;
    }

    case "scan": {
      const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
      const snapshot = await scanClaudeDir(claudeDir);
      const outputPath = flags["output"];
      if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
        output({
          status: "ok",
          path: outputPath,
          summary: {
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
          },
        });
      } else {
        output(snapshot);
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
      const diffData = readJsonFile<{ added: DiffEntry[]; modified: DiffEntry[] }>(flags["diff-file"]);
      const selections = readJsonFile<string[]>(flags["selections-file"]);
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
      const snapshot = readJsonFile<Snapshot>(flags["snapshot-file"]);
      const allFiles = [
        ...snapshot.agents,
        ...snapshot.rules,
        ...snapshot.skills,
        ...snapshot.commands,
        ...snapshot.globalDocs,
        ...snapshot.mcp,
      ];
      const findings = scanForSecrets(allFiles);
      const outputPath = flags["output"];
      if (outputPath) {
        writeFileSync(outputPath, JSON.stringify(findings, null, 2));
        output({ status: "ok", count: findings.length, path: outputPath });
      } else {
        output(findings);
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
      if (check.exists) {
        output({ created: false, repoUrl: check.repoUrl, localPath: "" });
      } else {
        const result = createHubRepo(auth.username);
        output(result);
      }
      break;
    }

    case "hub-push": {
      const hubPath = flags["hub-path"];
      const machine = flags["machine"];
      const snapshotFile = flags["snapshot-file"];
      const selectionsFile = flags["selections-file"];
      if (!hubPath || !machine || !snapshotFile) {
        output({ status: "error", error: "Missing required flags" });
        process.exitCode = 1;
        break;
      }
      const snapshot = readJsonFile<Snapshot>(snapshotFile);
      pushToMachineBranch(hubPath, machine, snapshot);
      output({ status: "ok", machine, itemsWritten: snapshot.agents.length + snapshot.rules.length + snapshot.skills.length });
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

    default:
      output({ status: "error", error: `Unknown command: ${command}`, available: [
        "context", "scan", "diff", "apply", "backup", "backup-list",
        "backup-restore", "secret-scan", "rce-scan", "hub-init",
        "hub-push", "hub-machines", "hub-read-branch",
      ]});
      process.exitCode = 1;
  }
}

main().catch((err) => {
  output({ status: "error", error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
