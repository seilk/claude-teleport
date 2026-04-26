import type { FileEntry } from "./types.js";
export declare function hashContent(content: string): string;
export declare function isTextFile(filePath: string): boolean;
export declare function scanDirectoryToFileEntries(baseDir: string, dirPath: string, category: string): FileEntry[];
