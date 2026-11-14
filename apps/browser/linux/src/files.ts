import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

export const tempSibling = (path: string) => join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);

export function replaceFileAtomically(path: string, contents: string | Buffer, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = tempSibling(path);
  const file = openSync(temp, "wx", mode);
  try {
    writeSync(file, typeof contents === "string" ? Buffer.from(contents, "utf8") : contents);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  try {
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
