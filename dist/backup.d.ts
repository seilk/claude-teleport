import type { BackupManifest } from "./types.js";
export declare function createBackup(claudeDir: string): Promise<BackupManifest>;
export declare function listBackups(claudeDir: string): BackupManifest[];
export declare function cleanOldBackups(keep: number, claudeDir: string): string[];
