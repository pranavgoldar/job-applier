import { createHash, randomUUID } from "node:crypto";
export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const sha = (b) => createHash("sha256").update(b).digest("hex");
