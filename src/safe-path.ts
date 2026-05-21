import { resolve, sep, dirname } from "node:path";
import { lstatSync, realpathSync, existsSync } from "node:fs";

// Resolve `relativePath` against `baseDir` and return the absolute target only
// if it stays inside `baseDir`. Rejects `..` traversal and absolute paths that
// escape (e.g. "agents/../../.zshrc", "/etc/passwd"). Returns null on escape.
export function resolveWithin(baseDir: string, relativePath: string): string | null {
  const base = resolve(baseDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Resolve symlinks on the nearest existing ancestor and confirm it still sits
// inside the real base — defeats a symlinked parent dir that passes the lexical
// check above.
function realParentWithin(base: string, target: string): boolean {
  try {
    const realBase = realpathSync(resolve(base));
    let dir = dirname(resolve(target));
    while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
    const realDir = realpathSync(dir);
    return realDir === realBase || realDir.startsWith(realBase + sep);
  } catch {
    return false;
  }
}

export type SafeTarget =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

// Full safety gate for a write target: containment + no symlink at the target +
// no symlinked ancestor escaping the base.
export function safeWriteTarget(baseDir: string, relativePath: string): SafeTarget {
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
const FORBIDDEN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isForbiddenSettingsKey(key: string): boolean {
  return FORBIDDEN_SETTINGS_KEYS.has(key);
}
