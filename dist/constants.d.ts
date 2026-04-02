export declare const TELEPORT_VERSION = "0.1.0";
export declare const CLAUDE_DIR: string;
export declare const TELEPORT_MACHINE_ID_FILE: string;
export declare const TELEPORT_BACKUPS_DIR: string;
export declare const PRIVATE_REPO_NAME = "claude-teleport-private";
export declare const PUBLIC_REPO_NAME = "claude-teleport-public";
export declare const CATEGORY_PATHS: Readonly<Record<string, string>>;
export declare const VALID_CATEGORIES: readonly string[];
export declare const GLOBAL_DOC_FILES: readonly ["CLAUDE.md", "AGENTS.md"];
export declare const DEFAULT_IGNORE_PATTERNS: readonly [".credentials.json", "settings.local.json", "*.local.json", ".env*", "**/secrets/**", "session-env/", "sessions/", "debug/", "telemetry/", "history.jsonl", "paste-cache/", "file-history/", "transcripts/", "todos/", "costs/", "downloads/", "backups/", "shell-snapshots/"];
export declare const SECRET_PATTERNS: ReadonlyArray<{
    readonly name: string;
    readonly regex: RegExp;
    readonly severity: "critical" | "high" | "medium";
}>;
export declare const RCE_PATTERNS: readonly ["curl ", "wget ", "eval(", "exec(", "child_process", "rm -rf", "sudo ", "chmod ", "> /dev/", "| sh", "| bash", "| zsh"];
export declare const CREDENTIAL_KEYS: readonly ["credentials", "apiKey", "api_key", "secret", "password", "token", "oauth", "auth"];
