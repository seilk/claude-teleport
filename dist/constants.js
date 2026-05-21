import { join } from "node:path";
import { homedir } from "node:os";
export const TELEPORT_VERSION = "0.1.0";
export const CLAUDE_DIR = join(homedir(), ".claude");
export const TELEPORT_MACHINE_ID_FILE = join(CLAUDE_DIR, "teleport-machine-id");
export const TELEPORT_BACKUPS_DIR = join(CLAUDE_DIR, "teleport-backups");
export const PRIVATE_REPO_NAME = "claude-teleport-private";
export const PUBLIC_REPO_NAME = "claude-teleport-public";
export const CATEGORY_PATHS = {
    agents: "agents",
    rules: "rules",
    skills: "skills",
    commands: "commands",
    mcp: "mcp-configs",
    scripts: "scripts",
    globalDocs: "",
};
export const STATUSLINE_SCRIPT_FILE = "statusline-command.sh";
// Directory names never worth syncing. A skill installed via `git clone` carries
// a nested .git/ (and often node_modules/); without this the scanner walks those
// internals, polluting the snapshot with hundreds of un-syncable files.
export const IGNORED_SCAN_DIRS = new Set([
    ".git",
    "node_modules",
]);
// Every category that can appear in a diff/selection — the directory-backed
// ones plus the structured/single-file surfaces. Used to validate apply
// selections, so it must list more than just CATEGORY_PATHS.
export const VALID_CATEGORIES = [
    ...Object.keys(CATEGORY_PATHS),
    "settings",
    "plugins",
    "marketplaces",
    "keybindings",
    "statuslineScript",
];
export const GLOBAL_DOC_FILES = ["CLAUDE.md", "AGENTS.md"];
export const DEFAULT_IGNORE_PATTERNS = [
    ".credentials.json",
    "settings.local.json",
    "*.local.json",
    ".env*",
    "**/secrets/**",
    "session-env/",
    "sessions/",
    "debug/",
    "telemetry/",
    "history.jsonl",
    "paste-cache/",
    "file-history/",
    "transcripts/",
    "todos/",
    "costs/",
    "downloads/",
    "backups/",
    "shell-snapshots/",
];
export const SECRET_PATTERNS = [
    { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
    { name: "GitHub Token", regex: /ghp_[A-Za-z0-9_]{36,}/g, severity: "critical" },
    { name: "GitHub OAuth", regex: /gho_[A-Za-z0-9_]{36,}/g, severity: "critical" },
    { name: "GitHub App Token", regex: /ghs_[A-Za-z0-9_]{36,}/g, severity: "critical" },
    { name: "GitHub PAT", regex: /github_pat_[A-Za-z0-9_]{22,}/g, severity: "critical" },
    { name: "Slack Token", regex: /xox[baprse]-[A-Za-z0-9-]+/g, severity: "critical" },
    { name: "Anthropic API Key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, severity: "critical" },
    { name: "OpenAI API Key", regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, severity: "critical" },
    { name: "Google API Key", regex: /AIza[0-9A-Za-z_-]{35}/g, severity: "critical" },
    { name: "JWT", regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "high" },
    { name: "Stripe Secret Key", regex: /sk_live_[A-Za-z0-9]{20,}/g, severity: "critical" },
    { name: "Stripe Publishable Key", regex: /pk_live_[A-Za-z0-9]{20,}/g, severity: "high" },
    { name: "PEM Private Key", regex: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: "critical" },
    { name: "Generic API Key", regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{20,}['"]?/gi, severity: "high" },
    { name: "Bearer Token", regex: /bearer\s+[A-Za-z0-9\-_\.]{20,}/gi, severity: "high" },
    { name: "Generic Secret", regex: /(?:secret|password|passwd|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi, severity: "medium" },
];
export const RCE_PATTERNS = [
    "curl ",
    "wget ",
    "eval(",
    "exec(",
    "child_process",
    "rm -rf",
    "sudo ",
    "chmod ",
    "> /dev/",
    "| sh",
    "| bash",
    "| zsh",
    "node -e",
    "node --eval",
    "python -c",
    "python3 -c",
    "perl -e",
    "ruby -e",
    "base64 -d",
    "base64 --decode",
    "/dev/tcp",
    "bash -i",
    "nc ",
    "ncat ",
    "osascript",
    "powershell",
    "-enc ",
];
export const CREDENTIAL_KEYS = [
    "credentials",
    "apiKey",
    "api_key",
    "secret",
    "password",
    "token",
    "oauth",
    "auth",
];
//# sourceMappingURL=constants.js.map