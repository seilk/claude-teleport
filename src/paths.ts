export function substituteForExport(
  content: string,
  homeDir: string,
  claudeDir: string,
): string {
  // Replace claude dir first (more specific, takes priority)
  let result = content.replaceAll(claudeDir, "$CLAUDE_DIR");
  // Then replace home dir for remaining paths
  result = result.replaceAll(homeDir, "$HOME");
  return result;
}

export function substituteForImport(
  content: string,
  homeDir: string,
  claudeDir: string,
): string {
  let result = content.replaceAll("$CLAUDE_DIR", claudeDir);
  result = result.replaceAll("$HOME", homeDir);
  return result;
}
