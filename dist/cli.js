#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanClaudeDir } from "./scanner.js";
import { diff } from "./differ.js";
import { applyDiff } from "./applier.js";
import { createBackup, listBackups } from "./backup.js";
import { scanForSecrets, scanForRcePatterns } from "./secrets.js";
import { getMachineId } from "./machine.js";
import { checkGhAuth, cloneOrPullHub, createHubRepo, hubExists, listMachineBranches, pushToMachineBranch, readFromBranch, readMachineFromMain, migrateRootToNamespaced, publicRepoExists, readMachineFromPublic, pushToPublicRepo } from "./git.js";
import { CLAUDE_DIR, VALID_CATEGORIES } from "./constants.js";
function parseArgs(args) {
    const command = args[0] ?? "";
    const flags = {};
    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            const next = args[i + 1];
            // Boolean flag: no next arg, or next arg is also a flag
            if (!next || next.startsWith("--")) {
                flags[key] = "";
            }
            else {
                flags[key] = next;
                i++;
            }
        }
    }
    return { command, flags };
}
function output(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}
function stderr(msg) {
    process.stderr.write(msg + "\n");
}
const COMMAND_HELP = {
    context: "Show auth status and machine info.\n  Usage: teleport context",
    scan: "Scan ~/.claude directory for configs.\n  Usage: teleport scan [--claude-dir <path>] [--output <file>] [--no-content]",
    diff: "Diff two snapshots.\n  Usage: teleport diff --source-file <file> --target-file <file> [--output <file>]",
    apply: "Apply selected diff entries.\n  Usage: teleport apply --diff-file <file> --selections-file <file> [--claude-dir <path>]",
    backup: "Create a backup of ~/.claude.\n  Usage: teleport backup [--claude-dir <path>]",
    "backup-list": "List available backups.\n  Usage: teleport backup-list [--claude-dir <path>]",
    "backup-restore": "Restore from a backup.\n  Usage: teleport backup-restore --timestamp <ts>",
    "secret-scan": "Scan snapshot for secrets.\n  Usage: teleport secret-scan --snapshot-file <file> [--output <file>]",
    "rce-scan": "Scan a file for RCE patterns.\n  Usage: teleport rce-scan --file <path>",
    "rce-scan-snapshot": "Scan all executable-ish content in a snapshot (scripts, statusline, hooks) for RCE patterns. Call before apply when pulling from untrusted sources.\n  Usage: teleport rce-scan-snapshot --snapshot-file <file> [--output <file>]",
    "hub-init": "Create or clone the private hub repo.\n  Usage: teleport hub-init [--clone-to <path>]",
    "hub-push": "Push snapshot to hub.\n  Usage: teleport hub-push --hub-path <path> --machine <alias> --snapshot-file <file>",
    "hub-machines": "List machines in the hub.\n  Usage: teleport hub-machines --hub-path <path>",
    "hub-read-branch": "Read snapshot from a branch.\n  Usage: teleport hub-read-branch --hub-path <path> --branch <name> [--output <file>]",
    "hub-check-public": "Check if a public teleport repo exists.\n  Usage: teleport hub-check-public --username <user>",
    "hub-read-public": "Read snapshot from a public repo.\n  Usage: teleport hub-read-public --hub-path <path> --machine <alias> [--output <file>]",
    "hub-push-public": "Push snapshot to a public repo.\n  Usage: teleport hub-push-public --hub-path <path> --machine <alias> --snapshot-file <file> [--username <user>]",
};
function readJsonFile(path) {
    return JSON.parse(readFileSync(path, "utf-8"));
}
function stripFileContent(entries) {
    return entries.map(({ relativePath, contentHash }) => ({ relativePath, contentHash }));
}
function stripContent(snapshot) {
    return {
        ...snapshot,
        agents: stripFileContent(snapshot.agents),
        rules: stripFileContent(snapshot.rules),
        skills: stripFileContent(snapshot.skills),
        commands: stripFileContent(snapshot.commands),
        globalDocs: stripFileContent(snapshot.globalDocs),
        mcp: stripFileContent(snapshot.mcp),
        scripts: stripFileContent(snapshot.scripts),
        keybindings: snapshot.keybindings
            ? { relativePath: snapshot.keybindings.relativePath, contentHash: snapshot.keybindings.contentHash }
            : undefined,
        statuslineScript: snapshot.statuslineScript
            ? { relativePath: snapshot.statuslineScript.relativePath, contentHash: snapshot.statuslineScript.contentHash }
            : undefined,
    };
}
async function main() {
    const { command, flags } = parseArgs(process.argv.slice(2));
    // Handle --help for any command
    if (flags["help"] !== undefined || command === "help") {
        const helpCmd = command === "help" ? (flags["command"] ?? "") : command;
        if (helpCmd && COMMAND_HELP[helpCmd]) {
            output({ command: helpCmd, help: COMMAND_HELP[helpCmd] });
        }
        else {
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
            if (verbose)
                stderr("Scanning claude directory...");
            const snapshot = await scanClaudeDir(claudeDir);
            if (verbose) {
                const counts = [
                    `agents: ${snapshot.agents.length}`,
                    `rules: ${snapshot.rules.length}`,
                    `skills: ${snapshot.skills.length}`,
                    `commands: ${snapshot.commands.length}`,
                    `globalDocs: ${snapshot.globalDocs.length}`,
                    `mcp: ${snapshot.mcp.length}`,
                    `scripts: ${snapshot.scripts.length}`,
                    `statuslineScript: ${snapshot.statuslineScript ? 1 : 0}`,
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
                scripts: snapshot.scripts.length,
                keybindings: snapshot.keybindings ? 1 : 0,
                statuslineScript: snapshot.statuslineScript ? 1 : 0,
            };
            const outputPath = flags["output"];
            if (outputPath) {
                writeFileSync(outputPath, JSON.stringify(result, null, 2));
                output({ status: "ok", path: outputPath, summary });
            }
            else {
                output(result);
            }
            break;
        }
        case "diff": {
            const source = readJsonFile(flags["source-file"]);
            const target = readJsonFile(flags["target-file"]);
            const result = diff(source, target);
            const outputPath = flags["output"];
            if (outputPath) {
                writeFileSync(outputPath, JSON.stringify(result, null, 2));
                output({ status: "ok", path: outputPath });
            }
            else {
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
            const diffData = readJsonFile(diffFile);
            const selections = readJsonFile(selectionsFile);
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
            const claudeDir = flags["claude-dir"] ?? CLAUDE_DIR;
            const backupPath = join(claudeDir, "teleport-backups", timestamp);
            if (!existsSync(backupPath)) {
                output({ status: "error", error: `Backup not found: ${timestamp}` });
                process.exitCode = 1;
                break;
            }
            // Create a safety backup before restoring
            const safetyBackup = await createBackup(claudeDir);
            stderr(`Safety backup created: ${safetyBackup.timestamp}`);
            // Copy backup contents back to claude dir
            const { cpSync } = await import("node:fs");
            const restoreDirs = ["agents", "rules", "skills", "commands", "mcp-configs", "plugins"];
            for (const dir of restoreDirs) {
                const src = join(backupPath, dir);
                if (existsSync(src)) {
                    cpSync(src, join(claudeDir, dir), { recursive: true });
                }
            }
            const restoreFiles = ["settings.json", "CLAUDE.md", "AGENTS.md", "keybindings.json"];
            for (const file of restoreFiles) {
                const src = join(backupPath, file);
                if (existsSync(src)) {
                    cpSync(src, join(claudeDir, file));
                }
            }
            output({ status: "ok", message: `Restored from ${timestamp}`, safetyBackup: safetyBackup.timestamp });
            break;
        }
        case "secret-scan": {
            const snapshotFilePath = flags["snapshot-file"];
            if (!snapshotFilePath) {
                output({ status: "error", error: "Missing required flag: --snapshot-file" });
                process.exitCode = 1;
                break;
            }
            const snapshot = readJsonFile(snapshotFilePath);
            const allFiles = [
                ...(snapshot.agents ?? []),
                ...(snapshot.rules ?? []),
                ...(snapshot.skills ?? []),
                ...(snapshot.commands ?? []),
                ...(snapshot.globalDocs ?? []),
                ...(snapshot.mcp ?? []),
                ...(snapshot.scripts ?? []),
            ];
            if (snapshot.statuslineScript)
                allFiles.push(snapshot.statuslineScript);
            if (snapshot.keybindings)
                allFiles.push(snapshot.keybindings);
            const findings = scanForSecrets(allFiles);
            const envelope = { status: "ok", findings, count: findings.length };
            const outputPath = flags["output"];
            if (outputPath) {
                writeFileSync(outputPath, JSON.stringify(envelope, null, 2));
                output({ status: "ok", count: findings.length, path: outputPath });
            }
            else {
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
        case "rce-scan-snapshot": {
            const snapshotFilePath = flags["snapshot-file"];
            if (!snapshotFilePath) {
                output({ status: "error", error: "Missing required flag: --snapshot-file" });
                process.exitCode = 1;
                break;
            }
            const snapshot = readJsonFile(snapshotFilePath);
            // Executable-ish surfaces: scripts (always run), statusline script, and any
            // hook commands declared inline in hooks.json. These are the apply-time RCE
            // risk vectors called out in CLAUDE.md safety rules.
            const riskyEntries = [
                ...(snapshot.scripts ?? []),
            ];
            if (snapshot.statuslineScript)
                riskyEntries.push(snapshot.statuslineScript);
            const entryFindings = riskyEntries
                .filter((e) => e.content)
                .map((e) => ({
                file: e.relativePath,
                findings: scanForRcePatterns(e.content ?? ""),
            }))
                .filter((r) => r.findings.length > 0);
            const hookFindings = (snapshot.hooks ?? [])
                .map((h) => ({
                file: `hooks.json#${h.name}`,
                findings: scanForRcePatterns(h.command ?? ""),
            }))
                .filter((r) => r.findings.length > 0);
            const combined = [...entryFindings, ...hookFindings];
            const envelope = { status: "ok", results: combined, count: combined.length };
            const outputPath = flags["output"];
            if (outputPath) {
                writeFileSync(outputPath, JSON.stringify(envelope, null, 2));
                output({ status: "ok", count: combined.length, path: outputPath });
            }
            else {
                output(envelope);
            }
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
            }
            else {
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
            const snapshot = readJsonFile(snapshotFile);
            // Migrate legacy layout if needed
            migrateRootToNamespaced(hubPath);
            if (verbose)
                stderr(`Pushing to hub for machine "${machine}"...`);
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
            }
            else {
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
            }
            else {
                output(mainSnapshot ?? { status: "error", error: "Machine not found on main" });
            }
            break;
        }
        case "hub-check-public": {
            const username = flags["username"];
            if (!username) {
                output({ status: "error", error: "Missing --username" });
                process.exitCode = 1;
                break;
            }
            const check = publicRepoExists(username);
            output(check);
            break;
        }
        case "hub-read-public": {
            const hubPath = flags["hub-path"];
            const alias = flags["machine"];
            if (!hubPath || !alias) {
                output({ status: "error", error: "Missing --hub-path or --machine" });
                process.exitCode = 1;
                break;
            }
            const pubSnapshot = readMachineFromPublic(hubPath, alias);
            const outputPath = flags["output"];
            if (outputPath && pubSnapshot) {
                writeFileSync(outputPath, JSON.stringify(pubSnapshot, null, 2));
                output({ status: "ok", path: outputPath });
            }
            else {
                output(pubSnapshot ?? { status: "error", error: "Machine not found in public repo" });
            }
            break;
        }
        case "hub-push-public": {
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
            const snapshot = readJsonFile(snapshotFile);
            const pushResult = pushToPublicRepo(hubPath, machine, snapshot, username);
            if (pushResult.status === "error") {
                output({ status: "error", error: pushResult.error });
                process.exitCode = 1;
                break;
            }
            const itemsWritten = snapshot.agents.length + snapshot.rules.length + snapshot.skills.length;
            output({ status: "ok", machine, itemsWritten });
            break;
        }
        default:
            output({ status: "error", error: `Unknown command: ${command}`, available: [
                    "context", "scan", "diff", "apply", "backup", "backup-list",
                    "backup-restore", "secret-scan", "rce-scan", "rce-scan-snapshot",
                    "hub-init", "hub-push", "hub-machines", "hub-read-branch", "hub-read-main",
                    "hub-check-public", "hub-read-public", "hub-push-public",
                ] });
            process.exitCode = 1;
    }
}
main().catch((err) => {
    output({ status: "error", error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map