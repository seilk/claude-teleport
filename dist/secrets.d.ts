import type { FileEntry, SecretFinding, Snapshot } from "./types.js";
export declare function scanForSecrets(entries: readonly FileEntry[]): SecretFinding[];
export declare function scanForRcePatterns(content: string): string[];
export declare function isCredentialKey(key: string): boolean;
export declare function redactCredentialsDeep(value: unknown): unknown;
export declare function snapshotScannableEntries(snapshot: Snapshot): FileEntry[];
export declare function scanSnapshotForSecrets(snapshot: Snapshot): SecretFinding[];
export declare function loadIgnorePatterns(filePath: string): string[];
