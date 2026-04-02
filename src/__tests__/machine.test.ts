import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMachineId, getMachineAlias, setMachineAlias, slugify } from "../machine.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    assert.equal(slugify("MacBook Pro"), "macbook-pro");
  });

  it("removes non-alphanumeric characters except hyphens", () => {
    assert.equal(slugify("Seil's MacBook (2024)"), "seil-s-macbook-2024");
  });

  it("collapses multiple hyphens", () => {
    assert.equal(slugify("my -- machine"), "my-machine");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("handles empty string", () => {
    assert.equal(slugify(""), "unknown");
  });
});

describe("getMachineId", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a new UUID if no file exists", () => {
    const idFile = join(tmpDir, "teleport-machine-id");
    const result = getMachineId(idFile);
    assert.ok(result.id);
    assert.match(result.id, /^[0-9a-f-]{36}$/);
    assert.ok(result.alias);
  });

  it("persists the ID to disk", () => {
    const idFile = join(tmpDir, "teleport-machine-id");
    const result1 = getMachineId(idFile);
    const result2 = getMachineId(idFile);
    assert.equal(result1.id, result2.id);
  });

  it("reads an existing file", () => {
    const idFile = join(tmpDir, "teleport-machine-id");
    writeFileSync(idFile, JSON.stringify({ id: "test-uuid", alias: "my-machine" }));
    const result = getMachineId(idFile);
    assert.equal(result.id, "test-uuid");
    assert.equal(result.alias, "my-machine");
  });
});

describe("setMachineAlias", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "teleport-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("updates the alias in the identity file", () => {
    const idFile = join(tmpDir, "teleport-machine-id");
    writeFileSync(idFile, JSON.stringify({ id: "test-uuid", alias: "old-name" }));
    setMachineAlias("new-name", idFile);
    const data = JSON.parse(readFileSync(idFile, "utf-8"));
    assert.equal(data.alias, "new-name");
    assert.equal(data.id, "test-uuid");
  });
});
