// Portable placeholders for machine-specific paths. We deliberately avoid
// "$HOME"/"$CLAUDE_DIR": those are real shell variables that legitimately
// appear in synced scripts (e.g. `echo $HOME` in a hook), and expanding them on
// import would silently rewrite working scripts. The `{{...}}` form does not
// occur in real config or scripts, so substitution is unambiguous.
export const HOME_PLACEHOLDER = "{{TELEPORT_HOME}}";
export const CLAUDE_DIR_PLACEHOLDER = "{{TELEPORT_CLAUDE_DIR}}";
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Replace `dir` only where it denotes the directory itself or a descendant —
// i.e. immediately followed by `/`, end of string, or a delimiter that cannot
// continue a path segment. This prevents a home dir like /Users/seil from
// corrupting a sibling such as /Users/seilk into "{{TELEPORT_HOME}}k".
function replaceDirPrefix(content, dir, placeholder) {
    if (!dir)
        return content;
    const re = new RegExp(escapeRegExp(dir) + "(?=/|$|[\\s\"'`:;=,)\\]}>|&])", "g");
    return content.replace(re, () => placeholder);
}
export function substituteForExport(content, homeDir, claudeDir) {
    // Claude dir first (more specific), then home for the remaining paths.
    let result = replaceDirPrefix(content, claudeDir, CLAUDE_DIR_PLACEHOLDER);
    result = replaceDirPrefix(result, homeDir, HOME_PLACEHOLDER);
    return result;
}
export function substituteForImport(content, homeDir, claudeDir) {
    let result = content.replaceAll(CLAUDE_DIR_PLACEHOLDER, claudeDir);
    result = result.replaceAll(HOME_PLACEHOLDER, homeDir);
    return result;
}
//# sourceMappingURL=paths.js.map