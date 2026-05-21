export declare function resolveWithin(baseDir: string, relativePath: string): string | null;
export type SafeTarget = {
    readonly ok: true;
    readonly path: string;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function safeWriteTarget(baseDir: string, relativePath: string): SafeTarget;
export declare function isForbiddenSettingsKey(key: string): boolean;
export declare function atomicWrite(path: string, content: string): void;
export declare function isSafeBackupTimestamp(timestamp: string): boolean;
