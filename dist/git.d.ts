import type { Snapshot } from "./types.js";
export interface GhAuthStatus {
    readonly authenticated: boolean;
    readonly username?: string;
    readonly os: string;
    readonly ghInstalled: boolean;
}
export interface HubInitResult {
    readonly created: boolean;
    readonly repoUrl: string;
    readonly localPath: string;
}
export interface MachineInfo {
    readonly alias: string;
    readonly id: string;
    readonly lastPush: string;
}
export declare function checkGhAuth(): GhAuthStatus;
export declare function getGhUsername(): string;
export declare function hubExists(username: string): {
    exists: boolean;
    repoUrl?: string;
};
export declare function createHubRepo(username: string): HubInitResult;
export declare function cloneOrPullHub(username: string, localPath: string): void;
export declare function pushToHub(localPath: string, message: string): void;
export declare function writeHubReadme(repoPath: string, username: string, isPublic?: boolean): void;
export declare function pushToMachineBranch(repoPath: string, machineAlias: string, snapshot: Snapshot, username?: string): void;
export declare function listMachineBranches(repoPath: string): MachineInfo[];
export declare function readFromBranch(repoPath: string, branchName: string): Snapshot | null;
export declare function readMachineFromMain(repoPath: string, alias: string): Snapshot | null;
export declare function migrateRootToNamespaced(repoPath: string): boolean;
export declare function createPublicRepo(username: string): string;
