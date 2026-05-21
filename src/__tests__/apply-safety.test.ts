import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDiff } from "../applier.js";
import type { DiffEntry } from "../types.js";

// Apply-time filesystem containment. A teleport-from import carries entries from
// an UNTRUSTED public repo; a crafted relativePath must never write outside
// ~/.claude, follow a symlink, or pollute the settings prototype.

describe("applyDiff filesystem containment", () => {
  let claudeDir: string;
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "teleport-safety-"));
    claudeDir = join(scratch, "dot-claude");
    mkdirSync(claudeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("rejects ../ traversal and writes nothing outside the config dir", async () => {
    const escapeTarget = join(scratch, "escape.txt");
    const selections: DiffEntry[] = [
      {
        category: "agents",
        relativePath: "agents/../../escape.txt",
        type: "added",
        sourceContent: "pwned",
      },
    ];
    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "error");
    assert.ok(!existsSync(escapeTarget), "must not write outside the config dir");
  });

  it("rejects an absolute relativePath", async () => {
    const abs = join(scratch, "abs-escape.txt");
    const selections: DiffEntry[] = [
      { category: "agents", relativePath: abs, type: "added", sourceContent: "pwned" },
    ];
    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "error");
    assert.ok(!existsSync(abs), "must not honor an absolute escape path");
  });

  it("refuses to write through a pre-existing symlink", async () => {
    const outside = join(scratch, "outside.txt");
    writeFileSync(outside, "original");
    mkdirSync(join(claudeDir, "agents"), { recursive: true });
    symlinkSync(outside, join(claudeDir, "agents", "evil.md"));

    const selections: DiffEntry[] = [
      { category: "agents", relativePath: "agents/evil.md", type: "added", sourceContent: "pwned" },
    ];
    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "error");
    assert.equal(readFileSync(outside, "utf-8"), "original", "symlink target must be untouched");
  });

  it("rejects a prototype-polluting settings key", async () => {
    const selections: DiffEntry[] = [
      {
        category: "settings",
        relativePath: "settings/__proto__",
        type: "added",
        sourceContent: JSON.stringify({ polluted: true }),
      },
    ];
    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "error");
    const probe: Record<string, unknown> = {};
    assert.equal(probe["polluted"], undefined, "Object prototype must not be polluted");
  });

  it("still applies a legitimate nested path", async () => {
    const selections: DiffEntry[] = [
      { category: "skills", relativePath: "skills/foo/SKILL.md", type: "added", sourceContent: "ok" },
    ];
    const result = await applyDiff(selections, claudeDir);
    assert.equal(result.applied[0].status, "ok");
    assert.equal(readFileSync(join(claudeDir, "skills", "foo", "SKILL.md"), "utf-8"), "ok");
  });
});
