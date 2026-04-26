import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
export function hashContent(content) {
    return createHash("sha256").update(content).digest("hex");
}
export function isTextFile(filePath) {
    try {
        const buf = readFileSync(filePath);
        // Check for null bytes as a simple binary detection
        for (let i = 0; i < Math.min(buf.length, 8000); i++) {
            if (buf[i] === 0)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
export function scanDirectoryToFileEntries(baseDir, dirPath, category) {
    const fullPath = join(baseDir, dirPath);
    if (!existsSync(fullPath))
        return [];
    const entries = [];
    function walk(dir) {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
            const itemPath = join(dir, item.name);
            if (item.isDirectory()) {
                walk(itemPath);
            }
            else if (item.isFile() && isTextFile(itemPath)) {
                const content = readFileSync(itemPath, "utf-8");
                entries.push({
                    relativePath: join(category, relative(fullPath, itemPath)),
                    contentHash: hashContent(content),
                    content,
                });
            }
        }
    }
    walk(fullPath);
    return entries;
}
//# sourceMappingURL=utils.js.map