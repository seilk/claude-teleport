import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { TELEPORT_MACHINE_ID_FILE } from "./constants.js";

export interface MachineIdentity {
  readonly id: string;
  readonly alias: string;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unknown";
}

export function getMachineAlias(): string {
  try {
    const name = execSync("scutil --get ComputerName", { encoding: "utf-8" }).trim();
    if (name) return slugify(name);
  } catch {
    // not macOS or scutil unavailable
  }
  try {
    const name = execSync("hostname", { encoding: "utf-8" }).trim();
    if (name) return slugify(name);
  } catch {
    // hostname unavailable
  }
  return "unknown";
}

function persistIdentity(idFile: string, identity: MachineIdentity): MachineIdentity {
  const dir = dirname(idFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(idFile, JSON.stringify(identity, null, 2));
  return identity;
}

export function getMachineId(idFile: string = TELEPORT_MACHINE_ID_FILE): MachineIdentity {
  if (existsSync(idFile)) {
    try {
      const data = JSON.parse(readFileSync(idFile, "utf-8"));
      if (data && typeof data.id === "string" && data.id && typeof data.alias === "string" && data.alias) {
        return { id: data.id, alias: data.alias };
      }
    } catch {
      // Corrupt id file — regenerate instead of aborting. getMachineId runs on
      // every scan, so a truncated file must not break the whole command.
    }
  }
  return persistIdentity(idFile, { id: randomUUID(), alias: getMachineAlias() });
}

export function setMachineAlias(alias: string, idFile: string = TELEPORT_MACHINE_ID_FILE): void {
  let id = randomUUID();
  try {
    const data = JSON.parse(readFileSync(idFile, "utf-8"));
    if (data && typeof data.id === "string" && data.id) id = data.id;
  } catch {
    // Corrupt or missing — keep the freshly generated id.
  }
  persistIdentity(idFile, { id, alias });
}
