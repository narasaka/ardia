import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./paths";

let logFolderReady = false;

function stamp(): string {
  return new Date().toISOString();
}

export function note(area: string, message: string): void {
  const line = `[ardia ${area}] ${message}`;
  console.log(line);
  try {
    if (!logFolderReady) {
      mkdirSync(dataDirectory(), { recursive: true });
      logFolderReady = true;
    }
    appendFileSync(join(dataDirectory(), "launch.log"), `${stamp()} ${area} ${message}\n`);
  } catch {
    logFolderReady = false;
  }
}

export function activation(message: string): void {
  note("activation", message);
  try {
    appendFileSync(join(dataDirectory(), "activation.log"), `${stamp()} ${message}\n`);
  } catch {}
}
