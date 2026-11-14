import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { defineModule, emit } from "../bridge";
import { launchConfig } from "../launch";
import { note } from "../log";
import { dataDirectory } from "../paths";
import { replaceFileAtomically } from "../files";

const READ_LIMIT = 1 << 20;
const SCHEMA_NAMES = ["config.schema.json", "theme.schema.json"];
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

const isThemeFile = (name: string) => /^themes\/[a-z0-9][a-z0-9_-]*\.json$/.test(name);
const isWatchable = (name: string) => name === "config.json" || name === "hooks.json" || isThemeFile(name);
const folder = () => launchConfig().configDirectory;

function stampOf(path: string): string {
  try {
    const info = statSync(path);
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : `unreadable:${(error as NodeJS.ErrnoException).code}`;
  }
}

function readFile(name: string) {
  if (!isWatchable(name)) return { status: "unreadable" };
  const path = join(folder(), name);
  const stamp = name === "hooks.json" ? stampOf(path) : undefined;
  try {
    const info = statSync(path);
    if (!info.isFile()) return { status: "notFile", stamp };
    if (info.size > READ_LIMIT) return { status: "tooBig", stamp };
    const bytes = readFileSync(path);
    if (bytes.length > READ_LIMIT) return { status: "tooBig", stamp };
    return { status: "ok", text: strictUtf8.decode(bytes), stamp };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { status: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable", stamp };
  }
}

let watchers: FSWatcher[] = [];
let watched = new Set<string>();
let pending: NodeJS.Timeout | undefined;

function changed(name: string | null): void {
  if (name && name !== "themes" && !watched.has(name)) return;
  clearTimeout(pending);
  pending = setTimeout(() => emit("ArdiaConfig", "onChange", {}), 50);
}

async function watchNames(names: string[]): Promise<void> {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  watched = new Set(names.filter(isWatchable));
  if (!watched.size) return;
  mkdirSync(folder(), { recursive: true });
  watchers.push(watch(folder(), (_event, file) => changed(file ? String(file) : null)));
  const themes = join(folder(), "themes");
  if ([...watched].some(isThemeFile) && existsSync(themes)) watchers.push(watch(themes, (_event, file) => changed(file ? `themes/${String(file)}` : null)));
  for (const watcher of watchers) watcher.on("error", (error) => note("config", `watching the config folder failed: ${String(error)}`));
}

async function writeSchemas(files: Record<string, string>): Promise<string[]> {
  const written: string[] = [];
  const folders = [join(dataDirectory(), "config-schema")];
  if (existsSync(folder())) folders.push(folder());
  for (const target of folders) {
    mkdirSync(target, { recursive: true });
    for (const [name, contents] of Object.entries(files ?? {})) {
      if (!SCHEMA_NAMES.includes(name)) continue;
      const path = join(target, name);
      try {
        if (readFileSync(path, "utf8") === contents) continue;
      } catch {}
      replaceFileAtomically(path, contents);
      written.push(path);
    }
  }
  return written;
}

defineModule("ArdiaConfig", {
  sync: { readFile },
  async: { watch: watchNames, writeSchemas },
});
