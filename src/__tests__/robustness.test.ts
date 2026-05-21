import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMachineId, setMachineAlias } from "../machine.js";
import { isSafeBackupTimestamp, atomicWrite, isForbiddenSettingsKey } from "../safe-path.js";
import { VALID_CATEGORIES } from "../constants.js";

describe("getMachineId corruption resilience", () => {
  let dir: string;
  let idFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "teleport-machine-"));
    idFile = join(dir, "teleport-machine-id");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("regenerates a valid identity when the id file is corrupt", () => {
    writeFileSync(idFile, "{ this is not valid json");
    const identity = getMachineId(idFile);
    assert.ok(identity.id.length > 0 && identity.alias.length > 0);
    // file should now hold valid JSON
    const reread = JSON.parse(readFileSync(idFile, "utf-8"));
    assert.equal(reread.id, identity.id);
  });

  it("generates and persists an identity when the file is missing", () => {
    const identity = getMachineId(idFile);
    assert.ok(existsSync(idFile));
    assert.ok(identity.id.length > 0);
  });

  it("setMachineAlias on a corrupt file still produces a valid record", () => {
    writeFileSync(idFile, "garbage");
    setMachineAlias("my-laptop", idFile);
    const data = JSON.parse(readFileSync(idFile, "utf-8"));
    assert.equal(data.alias, "my-laptop");
    assert.ok(typeof data.id === "string" && data.id.length > 0);
  });
});

describe("isSafeBackupTimestamp", () => {
  it("accepts our timestamp format", () => {
    assert.ok(isSafeBackupTimestamp("2026-05-20T14-30-00-000Z"));
  });
  it("rejects traversal and separators", () => {
    assert.ok(!isSafeBackupTimestamp("../../etc"));
    assert.ok(!isSafeBackupTimestamp("a/b"));
    assert.ok(!isSafeBackupTimestamp(".."));
  });
});

describe("atomicWrite", () => {
  it("writes content and leaves no temp file behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "teleport-atomic-"));
    const target = join(dir, "settings.json");
    atomicWrite(target, '{"a":1}');
    assert.equal(readFileSync(target, "utf-8"), '{"a":1}');
    assert.deepEqual(readdirSync(dir), ["settings.json"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces a symlinked destination instead of writing through it", () => {
    const dir = mkdtempSync(join(tmpdir(), "teleport-atomic-link-"));
    const outside = join(dir, "outside.txt");
    const target = join(dir, "settings.json");
    writeFileSync(outside, "ORIGINAL");
    symlinkSync(outside, target); // settings.json -> outside.txt

    atomicWrite(target, "NEW");

    // The link target must be untouched; the destination becomes a real file.
    assert.equal(readFileSync(outside, "utf-8"), "ORIGINAL", "must not write through the symlink");
    assert.equal(lstatSync(target).isSymbolicLink(), false, "destination is now a regular file");
    assert.equal(readFileSync(target, "utf-8"), "NEW");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("isForbiddenSettingsKey", () => {
  it("blocks prototype-polluting keys and allows normal ones", () => {
    assert.ok(isForbiddenSettingsKey("__proto__"));
    assert.ok(isForbiddenSettingsKey("constructor"));
    assert.ok(isForbiddenSettingsKey("prototype"));
    assert.ok(!isForbiddenSettingsKey("theme"));
    assert.ok(!isForbiddenSettingsKey("statusLine"));
  });
});

describe("VALID_CATEGORIES", () => {
  it("includes structured/single-file categories so apply does not falsely warn", () => {
    for (const cat of ["settings", "plugins", "marketplaces", "keybindings", "statuslineScript"]) {
      assert.ok(VALID_CATEGORIES.includes(cat), `missing ${cat}`);
    }
  });
});
