import type { DiffEntry, ApplyResult } from "./types.js";
export declare function applyDiff(selections: readonly DiffEntry[], claudeDir: string): Promise<ApplyResult>;
