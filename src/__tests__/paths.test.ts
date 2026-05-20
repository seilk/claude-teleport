import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  substituteForExport,
  substituteForImport,
  HOME_PLACEHOLDER,
  CLAUDE_DIR_PLACEHOLDER,
} from "../paths.js";

describe("substituteForExport", () => {
  it("replaces claude dir with the claude placeholder (priority over home)", () => {
    const result = substituteForExport(
      "/Users/seil/.claude/settings.json",
      "/Users/seil",
      "/Users/seil/.claude",
    );
    assert.equal(result, `${CLAUDE_DIR_PLACEHOLDER}/settings.json`);
  });

  it("replaces home dir when not inside claude dir", () => {
    const result = substituteForExport(
      "/Users/seil/some/other/path",
      "/Users/seil",
      "/Users/seil/.claude",
    );
    assert.equal(result, `${HOME_PLACEHOLDER}/some/other/path`);
  });

  it("replaces a bare home dir bounded by a quote", () => {
    const result = substituteForExport(
      'home="/Users/seil"',
      "/Users/seil",
      "/Users/seil/.claude",
    );
    assert.equal(result, `home="${HOME_PLACEHOLDER}"`);
  });

  it("leaves non-matching paths unchanged", () => {
    const result = substituteForExport(
      "/usr/local/bin/something",
      "/Users/seil",
      "/Users/seil/.claude",
    );
    assert.equal(result, "/usr/local/bin/something");
  });

  it("does NOT corrupt a sibling dir that shares the home prefix", () => {
    // /Users/seil is a prefix of /Users/seilk — the sibling must be untouched.
    const result = substituteForExport(
      "/Users/seilk/data and /Users/seil/.claude/x",
      "/Users/seil",
      "/Users/seil/.claude",
    );
    assert.equal(result, `/Users/seilk/data and ${CLAUDE_DIR_PLACEHOLDER}/x`);
  });

  it("preserves a literal shell $HOME in script content", () => {
    const script = '#!/bin/sh\necho "$HOME and /Users/seil/.claude/log"\n';
    const result = substituteForExport(script, "/Users/seil", "/Users/seil/.claude");
    assert.ok(result.includes("$HOME"), "shell $HOME must survive export untouched");
    assert.ok(result.includes(`${CLAUDE_DIR_PLACEHOLDER}/log`));
  });
});

describe("substituteForImport", () => {
  it("expands the claude placeholder to the actual path", () => {
    const result = substituteForImport(
      `${CLAUDE_DIR_PLACEHOLDER}/agents/foo.md`,
      "/Users/bob",
      "/Users/bob/.claude",
    );
    assert.equal(result, "/Users/bob/.claude/agents/foo.md");
  });

  it("expands the home placeholder to the actual path", () => {
    const result = substituteForImport(
      `${HOME_PLACEHOLDER}/some/path`,
      "/Users/bob",
      "/Users/bob/.claude",
    );
    assert.equal(result, "/Users/bob/some/path");
  });

  it("does NOT touch a literal shell $HOME on import", () => {
    const result = substituteForImport('echo "$HOME"', "/Users/bob", "/Users/bob/.claude");
    assert.equal(result, 'echo "$HOME"');
  });

  it("round-trips across machines correctly", () => {
    const original = "/Users/seil/.claude/agents/planner.md";
    const exported = substituteForExport(original, "/Users/seil", "/Users/seil/.claude");
    const imported = substituteForImport(exported, "/Users/bob", "/Users/bob/.claude");
    assert.equal(imported, "/Users/bob/.claude/agents/planner.md");
  });
});
