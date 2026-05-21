import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanClaudeDir } from "../scanner.js";
import { applyDiff } from "../applier.js";
import { CLAUDE_DIR_PLACEHOLDER } from "../paths.js";
import type { DiffEntry } from "../types.js";

// Regression guard for the machine-level path-mismatch bug: substituteForExport
// /substituteForImport existed but were never wired into the scan->apply
// pipeline, so absolute paths like /Users/<name>/.claude were stored in the hub
// and re-applied verbatim, breaking on machines with a different home dir.

describe("path portability: scan normalizes, apply expands", () => {
  let claudeDir: string;

  beforeEach(() => {
    claudeDir = mkdtempSync(join(tmpdir(), "teleport-portability-"));
  });

  afterEach(() => {
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it("stores $CLAUDE_DIR in scanned file content, never the absolute scan path", async () => {
    mkdirSync(join(claudeDir, "scripts"), { recursive: true });
    writeFileSync(
      join(claudeDir, "scripts", "hook.sh"),
      `#!/bin/sh\nexec node "${claudeDir}/scripts/lib.js"\n`,
    );

    const snapshot = await scanClaudeDir(claudeDir);
    const script = snapshot.scripts.find((s) => s.relativePath.endsWith("hook.sh"));

    assert.ok(script, "expected the hook script to be scanned");
    assert.ok(
      script!.content!.includes(`${CLAUDE_DIR_PLACEHOLDER}/scripts/lib.js`),
      "absolute claude dir must be normalized to the portable placeholder",
    );
    assert.ok(
      !script!.content!.includes(claudeDir),
      "raw absolute scan path must never be stored in the snapshot",
    );
  });

  it("normalizes absolute paths inside settings.json string values", async () => {
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({ statusLine: { command: `${claudeDir}/statusline-command.sh` } }),
    );

    const snapshot = await scanClaudeDir(claudeDir);
    const statusLine = snapshot.settings.statusLine as { command: string };

    assert.equal(statusLine.command, `${CLAUDE_DIR_PLACEHOLDER}/statusline-command.sh`);
  });

  it("expands $CLAUDE_DIR back to the target machine path on apply", async () => {
    const selections: DiffEntry[] = [
      {
        category: "scripts",
        relativePath: "scripts/hook.sh",
        type: "added",
        sourceContent: `#!/bin/sh\nexec node "${CLAUDE_DIR_PLACEHOLDER}/scripts/lib.js"\n`,
      },
    ];

    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "ok");

    const written = readFileSync(join(claudeDir, "scripts", "hook.sh"), "utf-8");
    assert.ok(
      written.includes(`${claudeDir}/scripts/lib.js`),
      "placeholder must expand to the target machine's real path",
    );
    assert.ok(
      !written.includes(CLAUDE_DIR_PLACEHOLDER),
      "no portable placeholder should remain on disk",
    );
  });

  it("expands placeholders inside applied settings values", async () => {
    const selections: DiffEntry[] = [
      {
        category: "settings",
        relativePath: "settings/statusLine",
        type: "added",
        sourceContent: JSON.stringify({ command: `${CLAUDE_DIR_PLACEHOLDER}/statusline-command.sh` }),
      },
    ];

    await applyDiff(selections, claudeDir);

    const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    assert.equal(settings.statusLine.command, `${claudeDir}/statusline-command.sh`);
  });
});
