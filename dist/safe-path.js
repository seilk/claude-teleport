import { resolve, sep, dirname } from "node:path";
import { lstatSync, realpathSync, existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
// Resolve `relativePath` against `baseDir` and return the absolute target only
// if it stays inside `baseDir`. Rejects `..` traversal and absolute paths that
// escape (e.g. "agents/../../.zshrc", "/etc/passwd"). Returns null on escape.
export function resolveWithin(baseDir, relativePath) {
    const base = resolve(baseDir);
    const target = resolve(base, relativePath);
    if (target !== base && !target.startsWith(base + sep))
        return null;
    return target;
}
function isSymlink(path) {
    try {
        return lstatSync(path).isSymbolicLink();
    }
    catch {
        return false;
    }
}
// Resolve symlinks on the nearest existing ancestor and confirm it still sits
// inside the real base — defeats a symlinked parent dir that passes the lexical
// check above.
function realParentWithin(base, target) {
    try {
        const realBase = realpathSync(resolve(base));
        let dir = dirname(resolve(target));
        while (!existsSync(dir) && dir !== dirname(dir))
            dir = dirname(dir);
        const realDir = realpathSync(dir);
        return realDir === realBase || realDir.startsWith(realBase + sep);
    }
    catch {
        return false;
    }
}
// Full safety gate for a write target: containment + no symlink at the target +
// no symlinked ancestor escaping the base.
export function safeWriteTarget(baseDir, relativePath) {
    const target = resolveWithin(baseDir, relativePath);
    if (target === null) {
        return { ok: false, reason: `path "${relativePath}" escapes the config directory` };
    }
    if (isSymlink(target)) {
        return { ok: false, reason: `refusing to write through a symlink at "${relativePath}"` };
    }
    if (!realParentWithin(baseDir, target)) {
        return { ok: false, reason: `path "${relativePath}" resolves outside the config directory via a symlinked parent` };
    }
    return { ok: true, path: target };
}
// Settings keys that would pollute or corrupt the prototype chain when assigned.
const FORBIDDEN_SETTINGS_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);
export function isForbiddenSettingsKey(key) {
    return FORBIDDEN_SETTINGS_KEYS.has(key);
}
// Write via a temp file + rename so a crash mid-write can never truncate the
// existing file (notably the user's real settings.json). rename is atomic on
// the same filesystem; the temp lives in the target dir to guarantee that.
export function atomicWrite(path, content) {
    // Random suffix + same dir keeps rename atomic and the temp unpredictable.
    const tmp = `${path}.teleport-tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
        // "wx" = O_CREAT|O_EXCL: fail if tmp already exists, so an attacker-planted
        // symlink at the temp path can't redirect this write outside the dir.
        writeFileSync(tmp, content, { flag: "wx" });
        // rename replaces the destination (even if it's a symlink) rather than
        // following it, so it can't be used to write through a link either.
        renameSync(tmp, path);
    }
    catch (err) {
        try {
            unlinkSync(tmp);
        }
        catch {
            // temp may not exist (e.g. "wx" rejected a pre-existing path); nothing to clean
        }
        throw err;
    }
}
// A backup timestamp comes from a CLI flag and is joined onto a path. Allow only
// the characters produced by our own timestamp format; reject separators / "..".
export function isSafeBackupTimestamp(timestamp) {
    return /^[A-Za-z0-9._-]+$/.test(timestamp) && !timestamp.includes("..");
}
//# sourceMappingURL=safe-path.js.map