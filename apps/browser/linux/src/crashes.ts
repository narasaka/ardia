import { app, crashReporter } from "electron";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_BUILD, APP_VERSION } from "./build";
import { note } from "./log";

type CrashProcess = "browser" | "renderer" | "gpu" | "utility" | "plugin";

const PROCESS_TYPES: Record<string, CrashProcess> = { browser: "browser", renderer: "renderer", "gpu-process": "gpu", utility: "utility", ppapi: "plugin" };
const MOST_DUMPS = 20;
const KEEP_DUMPS_MS = 30 * 86_400_000;

export function startCrashReporter(): void {
  try {
    crashReporter.start({ submitURL: "", uploadToServer: false, compress: false, ignoreSystemCrashHandler: true, globalExtra: { _version: APP_VERSION, build: APP_BUILD } });
  } catch (error) {
    note("crashes", `the crash reporter didn't start: ${String(error)}`);
  }
}

function annotation(dump: Buffer, key: string): string | null {
  const at = dump.indexOf(Buffer.from(`${key}\0`, "latin1"));
  if (at < 0) return null;
  const tail = dump.subarray(at + key.length + 1, at + key.length + 200).toString("latin1");
  const value = /[\x20-\x7e]{2,64}/.exec(tail);
  return value ? value[0] : null;
}

function processOf(dump: Buffer): CrashProcess {
  const type = annotation(dump, "ptype") ?? annotation(dump, "process_type");
  return (type && PROCESS_TYPES[type]) || "browser";
}

function dumps(): { path: string; fileTime: number }[] {
  const found: { path: string; fileTime: number }[] = [];
  for (const state of ["completed", "pending"]) {
    const folder = join(app.getPath("crashDumps"), state);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) if (name.endsWith(".dmp")) found.push({ path: join(folder, name), fileTime: statSync(join(folder, name)).mtimeMs });
  }
  return found;
}

export function pruneCrashDumps(now = Date.now()): void {
  for (const dump of dumps()) if (now - dump.fileTime > KEEP_DUMPS_MS) rmSync(dump.path, { force: true });
}

export function crashReports(since: number) {
  return dumps()
    .filter((dump) => dump.fileTime > since)
    .sort((a, b) => a.fileTime - b.fileTime)
    .slice(-MOST_DUMPS)
    .map(({ path, fileTime }) => {
      const dump = readFileSync(path);
      const crashed = processOf(dump);
      return {
        time: fileTime,
        fileTime,
        process: crashed,
        appVersion: crashed === "browser" ? APP_VERSION : undefined,
        build: crashed === "browser" ? APP_BUILD : undefined,
        engineVersion: process.versions.chrome,
        frames: [],
      };
    });
}
