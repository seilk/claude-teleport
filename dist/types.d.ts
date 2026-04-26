export interface FileEntry {
    readonly relativePath: string;
    readonly contentHash: string;
    readonly content?: string;
}
export interface PluginEntry {
    readonly name: string;
    readonly marketplace: string;
    readonly version?: string;
    readonly scope?: "user" | "project";
    readonly enabled?: boolean;
    readonly gitCommitSha?: string;
}
export interface MarketplaceSource {
    readonly source: "github" | "git";
    readonly repo?: string;
    readonly url?: string;
}
export interface Marketplace {
    readonly name: string;
    readonly source: MarketplaceSource;
}
export interface HookEntry {
    readonly name: string;
    readonly event: string;
    readonly command: string;
    readonly config?: Readonly<Record<string, unknown>>;
}
export interface Snapshot {
    readonly teleportVersion: string;
    readonly machineId: string;
    readonly machineAlias: string;
    readonly plugins: readonly PluginEntry[];
    readonly marketplaces: readonly Marketplace[];
    readonly agents: readonly FileEntry[];
    readonly rules: readonly FileEntry[];
    readonly skills: readonly FileEntry[];
    readonly commands: readonly FileEntry[];
    readonly settings: Readonly<Record<string, unknown>>;
    readonly globalDocs: readonly FileEntry[];
    readonly hooks: readonly HookEntry[];
    readonly mcp: readonly FileEntry[];
    readonly scripts: readonly FileEntry[];
    readonly keybindings?: FileEntry;
    readonly statuslineScript?: FileEntry;
}
export type DiffType = "added" | "removed" | "modified" | "unchanged";
export type RiskLevel = "high" | "medium" | "low";
export interface DiffEntry {
    readonly category: string;
    readonly relativePath: string;
    readonly type: DiffType;
    readonly sourceContent?: string;
    readonly targetContent?: string;
    readonly riskLevel?: RiskLevel;
}
export interface DiffSummary {
    readonly added: Readonly<Record<string, number>>;
    readonly modified: Readonly<Record<string, number>>;
    readonly removed: Readonly<Record<string, number>>;
    readonly hasChanges: boolean;
}
export interface Diff {
    readonly added: readonly DiffEntry[];
    readonly removed: readonly DiffEntry[];
    readonly modified: readonly DiffEntry[];
    readonly unchanged: readonly DiffEntry[];
    readonly summary: DiffSummary;
}
export interface BackupManifest {
    readonly timestamp: string;
    readonly claudeDir: string;
}
export interface TeleportConfig {
    readonly hubRepoName: string;
    readonly machineId: string;
    readonly machineAlias: string;
    readonly hubLocalPath: string;
}
export interface ApplyResult {
    readonly applied: readonly ApplyItemResult[];
    readonly pluginInstructions: readonly string[];
    readonly marketplaceInstructions: readonly string[];
}
export interface ApplyItemResult {
    readonly path: string;
    readonly status: "ok" | "error";
    readonly error?: string;
}
export type SecretSeverity = "critical" | "high" | "medium";
export interface SecretFinding {
    readonly file: string;
    readonly line: number;
    readonly pattern: string;
    readonly severity: SecretSeverity;
    readonly match: string;
}
