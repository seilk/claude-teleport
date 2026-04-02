import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { substituteForExport, substituteForImport } from "../paths.js";

describe("substituteForExport", () => {
  it("replaces home directory with $HOME", () => {
    const result = substituteForExport(
      "/Users/seil/.claude/agents/foo.md",
      "/Users/seil",
      "/Users/seil/.claude"
    );
    assert.equal(result, "$CLAUDE_DIR/agents/foo.md");
  });

  it("replaces claude dir with $CLAUDE_DIR (takes priority over $HOME)", () => {
    const result = substituteForExport(
      "/Users/seil/.claude/settings.json",
      "/Users/seil",
      "/Users/seil/.claude"
    );
    assert.equal(result, "$CLAUDE_DIR/settings.json");
  });

  it("replaces home dir when not inside claude dir", () => {
    const result = substituteForExport(
      "/Users/seil/some/other/path",
      "/Users/seil",
      "/Users/seil/.claude"
    );
    assert.equal(result, "$HOME/some/other/path");
  });

  it("leaves non-matching paths unchanged", () => {
    const result = substituteForExport(
      "/usr/local/bin/something",
      "/Users/seil",
      "/Users/seil/.claude"
    );
    assert.equal(result, "/usr/local/bin/something");
  });
});

describe("substituteForImport", () => {
  it("replaces $CLAUDE_DIR with actual path", () => {
    const result = substituteForImport(
      "$CLAUDE_DIR/agents/foo.md",
      "/Users/bob",
      "/Users/bob/.claude"
    );
    assert.equal(result, "/Users/bob/.claude/agents/foo.md");
  });

  it("replaces $HOME with actual path", () => {
    const result = substituteForImport(
      "$HOME/some/path",
      "/Users/bob",
      "/Users/bob/.claude"
    );
    assert.equal(result, "/Users/bob/some/path");
  });

  it("round-trips correctly", () => {
    const original = "/Users/seil/.claude/agents/planner.md";
    const exported = substituteForExport(original, "/Users/seil", "/Users/seil/.claude");
    const imported = substituteForImport(exported, "/Users/bob", "/Users/bob/.claude");
    assert.equal(imported, "/Users/bob/.claude/agents/planner.md");
  });
});
