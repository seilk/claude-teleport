import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackup, listBackups, cleanOldBackups } from "../backup.js";

describe("createBackup", () => {
  let mockClaudeDir: string;

  beforeEach(() => {
    mockClaudeDir = mkdtempSync(join(tmpdir(), "teleport-backup-"));
    mkdirSync(join(mockClaudeDir, "agents"), { recursive: true });
    writeFileSync(join(mockClaudeDir, "agents", "a.md"), "agent content");
    writeFileSync(join(mockClaudeDir, "settings.json"), '{"theme":"dark"}');
  });

  afterEach(() => {
    rmSync(mockClaudeDir, { recursive: true, force: true });
  });

  it("creates a timestamped backup directory", async () => {
    const manifest = await createBackup(mockClaudeDir);
    assert.ok(manifest.timestamp);
    assert.ok(existsSync(join(mockClaudeDir, "teleport-backups", manifest.timestamp)));
  });

  it("copies files to the backup", async () => {
    const manifest = await createBackup(mockClaudeDir);
    const backupDir = join(mockClaudeDir, "teleport-backups", manifest.timestamp);
    assert.ok(existsSync(join(backupDir, "agents", "a.md")));
    assert.ok(existsSync(join(backupDir, "settings.json")));
  });
});

describe("listBackups", () => {
  let mockClaudeDir: string;

  beforeEach(() => {
    mockClaudeDir = mkdtempSync(join(tmpdir(), "teleport-backup-"));
  });

  afterEach(() => {
    rmSync(mockClaudeDir, { recursive: true, force: true });
  });

  it("returns empty array when no backups exist", () => {
    const backups = listBackups(mockClaudeDir);
    assert.deepEqual(backups, []);
  });

  it("lists existing backups sorted by timestamp", async () => {
    await createBackup(mockClaudeDir);
    await new Promise((r) => setTimeout(r, 10));
    await createBackup(mockClaudeDir);
    const backups = listBackups(mockClaudeDir);
    assert.equal(backups.length, 2);
    assert.ok(backups[0].timestamp <= backups[1].timestamp);
  });
});

describe("cleanOldBackups", () => {
  let mockClaudeDir: string;

  beforeEach(() => {
    mockClaudeDir = mkdtempSync(join(tmpdir(), "teleport-backup-"));
  });

  afterEach(() => {
    rmSync(mockClaudeDir, { recursive: true, force: true });
  });

  it("removes oldest backups beyond keep count", async () => {
    for (let i = 0; i < 4; i++) {
      await createBackup(mockClaudeDir);
      await new Promise((r) => setTimeout(r, 10));
    }
    const removed = cleanOldBackups(2, mockClaudeDir);
    assert.ok(removed.length > 0);
    const remaining = listBackups(mockClaudeDir);
    assert.equal(remaining.length, 2);
  });

  it("never deletes the first-ever backup", async () => {
    for (let i = 0; i < 3; i++) {
      await createBackup(mockClaudeDir);
      await new Promise((r) => setTimeout(r, 10));
    }
    const allBefore = listBackups(mockClaudeDir);
    const firstTimestamp = allBefore[0].timestamp;
    cleanOldBackups(1, mockClaudeDir);
    const remaining = listBackups(mockClaudeDir);
    assert.ok(remaining.some((b) => b.timestamp === firstTimestamp));
  });
});
