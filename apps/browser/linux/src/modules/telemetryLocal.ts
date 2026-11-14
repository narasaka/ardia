import { app } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { defineModule } from "../bridge";
import { launchConfig } from "../launch";
import { dataDirectory } from "../paths";

const DAY_MS = 86_400_000;
const DAY_FILE = /^(cli-)?\d{4}-\d{2}-\d{2}\.jsonl$/;
const FLUSH_AFTER_MS = 2000;

let maxBytes = 20 * 1024 * 1024;
let keepMs = 30 * DAY_MS;
let droppedSincePrune = 0;
const writeMs: number[] = [];
const buffered = new Map<string, string[]>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const folder = () => join(dataDirectory(), "Telemetry", "local");
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);
const dayOf = (file: string) => file.replace(/^cli-/, "").slice(0, 10);
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

function write(day: string, lines: string[]): void {
  const started = performance.now();
  mkdirSync(folder(), { recursive: true });
  appendFileSync(join(folder(), `${day}.jsonl`), lines.map((line) => (line.endsWith("\n") ? line : `${line}\n`)).join(""));
  writeMs.push(performance.now() - started);
  if (writeMs.length > 4096) writeMs.shift();
}

function flush(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  for (const [day, lines] of buffered) write(day, lines);
  buffered.clear();
}

function append(day: string, text: string): void {
  if (!validDay(day) || !text) return;
  buffered.set(day, [...(buffered.get(day) ?? []), text]);
  flushTimer ??= setTimeout(flush, FLUSH_AFTER_MS);
}

function appendNow(day: string, text: string): void {
  if (!validDay(day) || !text) return;
  flush();
  write(day, [text]);
}

const newlines = (text: string) => text.split("\n").length - 1;

function files(): { name: string; path: string; bytes: number; day: string }[] {
  if (!existsSync(folder())) return [];
  return readdirSync(folder())
    .filter((name) => DAY_FILE.test(name))
    .map((name) => ({ name, path: join(folder(), name), bytes: statSync(join(folder(), name)).size, day: dayOf(name) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

async function prune(now: number) {
  flush();
  const started = performance.now();
  const oldest = utcDay(now - keepMs);
  for (const file of files())
    if (file.day < oldest) {
      droppedSincePrune += newlines(readFileSync(file.path, "utf8"));
      rmSync(file.path, { force: true });
    }
  let kept = files();
  let total = kept.reduce((sum, file) => sum + file.bytes, 0);
  while (total > maxBytes && kept.length) {
    const first = kept.shift()!;
    const text = readFileSync(first.path, "utf8");
    const excess = total - maxBytes;
    if (excess >= first.bytes || !kept.length) {
      droppedSincePrune += newlines(text);
      rmSync(first.path, { force: true });
      total -= first.bytes;
      continue;
    }
    const cut = text.indexOf("\n", excess);
    const tail = cut < 0 ? "" : text.slice(cut + 1);
    droppedSincePrune += newlines(text.slice(0, cut + 1));
    writeFileSync(first.path, tail);
    total -= first.bytes - Buffer.byteLength(tail);
  }
  kept = files();
  const stats = {
    bytes: kept.reduce((sum, file) => sum + file.bytes, 0),
    lines: kept.reduce((sum, file) => sum + newlines(readFileSync(file.path, "utf8")), 0),
    files: kept.length,
    droppedLines: droppedSincePrune,
    pruneMs: performance.now() - started,
    writeMs: [...writeMs],
  };
  droppedSincePrune = 0;
  writeMs.length = 0;
  return stats;
}

function collect(since: number): { data: string; lines: number } {
  flush();
  const first = utcDay(since);
  let data = "";
  for (const file of files()) {
    if (file.day < first) continue;
    const text = readFileSync(file.path, "utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      const at = /^\{"at":(\d+)/.exec(line);
      if (at && Number(at[1]) < since) continue;
      data += `${line}\n`;
    }
  }
  return { data, lines: newlines(data) };
}

async function exportForReport(since: number) {
  const { data, lines } = collect(since);
  if (!lines) return null;
  const target = join(dataDirectory(), "Telemetry", "export", "local-events.jsonl.gz");
  mkdirSync(join(dataDirectory(), "Telemetry", "export"), { recursive: true });
  const gz = gzipSync(data);
  writeFileSync(target, gz);
  return { path: target, bytes: gz.length, lines };
}

async function exportToDownloads(now: number) {
  const { data, lines } = collect(now - keepMs);
  if (!lines) return null;
  const downloads = launchConfig().isolated ? join(dataDirectory(), "Downloads") : app.getPath("downloads");
  mkdirSync(downloads, { recursive: true });
  const base = `Ardia data ${utcDay(now)}`;
  let target = join(downloads, `${base}.jsonl`);
  for (let n = 2; existsSync(target); n++) target = join(downloads, `${base} ${n}.jsonl`);
  writeFileSync(target, data);
  return { path: target, bytes: Buffer.byteLength(data), lines };
}

process.on("exit", flush);

defineModule("ArdiaTelemetryLocal", {
  sync: {
    append,
    appendNow,
    configure: (bytes: number, days: number) => {
      if (Number.isFinite(bytes) && bytes > 0) maxBytes = bytes;
      if (Number.isFinite(days) && days > 0) keepMs = days * DAY_MS;
    },
  },
  async: {
    prune,
    clear: async () => {
      buffered.clear();
      rmSync(folder(), { recursive: true, force: true });
    },
    exportForReport,
    exportToDownloads,
  },
});
