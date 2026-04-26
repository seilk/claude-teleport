export function substituteForExport(content, homeDir, claudeDir) {
    // Replace claude dir first (more specific, takes priority)
    let result = content.replaceAll(claudeDir, "$CLAUDE_DIR");
    // Then replace home dir for remaining paths
    result = result.replaceAll(homeDir, "$HOME");
    return result;
}
export function substituteForImport(content, homeDir, claudeDir) {
    let result = content.replaceAll("$CLAUDE_DIR", claudeDir);
    result = result.replaceAll("$HOME", homeDir);
    return result;
}
//# sourceMappingURL=paths.js.map