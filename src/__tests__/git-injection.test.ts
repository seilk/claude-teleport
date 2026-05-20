import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFromBranch, pushToPublicRepo } from "../git.js";
import type { Snapshot } from "../types.js";

function minimalSnapshot(): Snapshot {
  return {
    teleportVersion: "0.1.0",
    machineId: "id",
    machineAlias: "m",
    plugins: [],
    marketplaces: [],
    agents: [],
    rules: [],
    skills: [],
    commands: [],
    settings: {},
    globalDocs: [],
    hooks: [],
    mcp: [],
    scripts: [],
  };
}

// Branch names / machine aliases reach git from CLI flags. They must never be
// able to break out into a shell or traverse the filesystem.

describe("git command-injection hardening", () => {
  it("readFromBranch rejects a shell-metacharacter branch and runs no command", () => {
    const marker = join(tmpdir(), `teleport-pwned-${Date.now()}`);
    const result = readFromBranch(tmpdir(), `x; touch ${marker}`);
    assert.equal(result, null);
    assert.ok(!existsSync(marker), "no injected shell command should have executed");
    if (existsSync(marker)) rmSync(marker, { force: true });
  });

  it("readFromBranch rejects command substitution syntax", () => {
    const result = readFromBranch(tmpdir(), "$(reboot)");
    assert.equal(result, null);
  });

  it("pushToPublicRepo rejects a traversing / injecting alias", () => {
    assert.equal(pushToPublicRepo(tmpdir(), "../../evil", minimalSnapshot(), "").status, "error");
    assert.equal(pushToPublicRepo(tmpdir(), 'x"; touch pwned; #', minimalSnapshot(), "").status, "error");
  });
});
