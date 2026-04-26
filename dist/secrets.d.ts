import type { FileEntry, SecretFinding } from "./types.js";
export declare function scanForSecrets(entries: readonly FileEntry[]): SecretFinding[];
export declare function scanForRcePatterns(content: string): string[];
export declare function isCredentialKey(key: string): boolean;
export declare function loadIgnorePatterns(filePath: string): string[];
