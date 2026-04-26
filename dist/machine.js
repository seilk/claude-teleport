import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { TELEPORT_MACHINE_ID_FILE } from "./constants.js";
export function slugify(input) {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-|-$/g, "");
    return slug || "unknown";
}
export function getMachineAlias() {
    try {
        const name = execSync("scutil --get ComputerName", { encoding: "utf-8" }).trim();
        if (name)
            return slugify(name);
    }
    catch {
        // not macOS or scutil unavailable
    }
    try {
        const name = execSync("hostname", { encoding: "utf-8" }).trim();
        if (name)
            return slugify(name);
    }
    catch {
        // hostname unavailable
    }
    return "unknown";
}
export function getMachineId(idFile = TELEPORT_MACHINE_ID_FILE) {
    if (existsSync(idFile)) {
        const data = JSON.parse(readFileSync(idFile, "utf-8"));
        return { id: data.id, alias: data.alias };
    }
    const identity = {
        id: randomUUID(),
        alias: getMachineAlias(),
    };
    const dir = dirname(idFile);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(idFile, JSON.stringify(identity, null, 2));
    return identity;
}
export function setMachineAlias(alias, idFile = TELEPORT_MACHINE_ID_FILE) {
    const data = JSON.parse(readFileSync(idFile, "utf-8"));
    writeFileSync(idFile, JSON.stringify({ ...data, alias }, null, 2));
}
//# sourceMappingURL=machine.js.map