export function readVersions(root: string): { file: string; version: string | undefined }[];
export function setVersion(root: string, version: string): void;
export function disagreements(root: string, expected?: string): { file: string; version: string | undefined }[];
