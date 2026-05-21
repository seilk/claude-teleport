import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanDirectoryToFileEntries } from "../utils.js";

describe("scanDirectoryToFileEntries", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "teleport-walk-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("captures real files under the category dir", () => {
    mkdirSync(join(base, "skills", "myskill"), { recursive: true });
    writeFileSync(join(base, "skills", "myskill", "SKILL.md"), "# hi");
    const entries = scanDirectoryToFileEntries(base, "skills", "skills");
    assert.deepEqual(
      entries.map((e) => e.relativePath),
      ["skills/myskill/SKILL.md"],
    );
  });

  it("does not descend into nested .git or node_modules directories", () => {
    const skill = join(base, "skills", "cloned-skill");
    mkdirSync(join(skill, ".git", "hooks"), { recursive: true });
    mkdirSync(join(skill, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "# real");
    writeFileSync(join(skill, ".git", "config"), "[core]");
    writeFileSync(join(skill, ".git", "hooks", "pre-commit.sample"), "#!/bin/sh");
    writeFileSync(join(skill, "node_modules", "pkg", "index.js"), "module.exports={}");

    const paths = scanDirectoryToFileEntries(base, "skills", "skills").map((e) => e.relativePath);

    assert.deepEqual(paths, ["skills/cloned-skill/SKILL.md"]);
    assert.ok(!paths.some((p) => p.includes(".git")), "must not scan nested .git/");
    assert.ok(!paths.some((p) => p.includes("node_modules")), "must not scan node_modules/");
  });
});
