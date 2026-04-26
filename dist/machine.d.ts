export interface MachineIdentity {
    readonly id: string;
    readonly alias: string;
}
export declare function slugify(input: string): string;
export declare function getMachineAlias(): string;
export declare function getMachineId(idFile?: string): MachineIdentity;
export declare function setMachineAlias(alias: string, idFile?: string): void;
