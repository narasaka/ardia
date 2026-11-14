import type { DatabaseSync } from "node:sqlite";
import { defineDomain, emitDomainEvent } from "../engine/domains";
import { onPage } from "../engine/pages";
import { database, onProfileOpened, savedDatabase, transaction } from "./database";
import { isPrivateProfile } from "./profiles";

type WireRow = { u: string; t: string; n: number };
type Change = ({ kind: "visit"; at: number } & WireRow) | { kind: "modified"; rows: WireRow[] } | { kind: "deleted"; all: boolean; urls: string[] };

const DEFAULT_MAX_URLS = 5000;
const DEFAULT_MAX_VISITS = 50;
const KEEP_MS = 90 * 86_400_000;
const BATCH_DELAY_MS = 20;
const BATCH_MAX = 2000;
const NOT_HISTORY_SCHEMES = new Set(["about:", "blob:", "chrome:", "chrome-extension:", "chrome-untrusted:", "data:", "devtools:", "javascript:", "view-source:", "ardia:", "filesystem:"]);
const RELOAD = /reload/i;

export function canAddToHistory(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return !NOT_HISTORY_SCHEMES.has(parsed.protocol) && (parsed.protocol === "file:" || !!parsed.host);
}

const pending = new Map<string, { changes: Change[]; timer: ReturnType<typeof setTimeout> | null }>();

function flush(profile: string) {
  const batch = pending.get(profile);
  if (!batch) return;
  pending.delete(profile);
  if (batch.timer) clearTimeout(batch.timer);
  if (batch.changes.length) emitDomainEvent("history.changed", { profile, kind: "batch", changes: batch.changes });
}

function changed(profile: string, change: Change) {
  let batch = pending.get(profile);
  if (!batch) pending.set(profile, (batch = { changes: [], timer: null }));
  batch.changes.push(change);
  if (batch.changes.length >= BATCH_MAX) return flush(profile);
  batch.timer ??= setTimeout(() => flush(profile), BATCH_DELAY_MS);
}

type UrlRow = { id: number; url: string; title: string; visit_count: number; last_visit: number };

const urlRow = (db: DatabaseSync, url: string) => db.prepare("SELECT id, url, title, visit_count, last_visit FROM urls WHERE url = ?").get(url) as UrlRow | undefined;

function ensureUrl(db: DatabaseSync, url: string, title: string): UrlRow {
  const known = urlRow(db, url);
  if (known) return known;
  const { lastInsertRowid } = db.prepare("INSERT INTO urls (url, title) VALUES (?, ?)").run(url, title);
  return { id: Number(lastInsertRowid), url, title, visit_count: 0, last_visit: 0 };
}

function addVisit(db: DatabaseSync, row: UrlRow, at: number, title: string) {
  db.prepare("INSERT INTO visits (url_id, at) VALUES (?, ?)").run(row.id, at);
  const nextTitle = title || row.title;
  db.prepare("UPDATE urls SET visit_count = visit_count + 1, last_visit = MAX(last_visit, ?), title = ? WHERE id = ?").run(at, nextTitle, row.id);
  row.visit_count += 1;
  row.last_visit = Math.max(row.last_visit, at);
  row.title = nextTitle;
}

export function recordVisit(profile: string, url: string, title: string, at = Date.now()) {
  if (isPrivateProfile(profile) || !canAddToHistory(url)) return;
  const db = database(profile);
  const row = transaction(db, () => {
    const found = ensureUrl(db, url, title);
    addVisit(db, found, at, title);
    return found;
  });
  changed(profile, { kind: "visit", u: row.url, t: row.title, n: row.visit_count, at: Math.floor(at) });
}

export function recordTitle(profile: string, url: string, title: string) {
  if (isPrivateProfile(profile) || !title || !canAddToHistory(url)) return;
  const db = database(profile);
  const row = urlRow(db, url);
  if (!row || row.title === title) return;
  db.prepare("UPDATE urls SET title = ? WHERE id = ?").run(title, row.id);
  changed(profile, { kind: "modified", rows: [{ u: row.url, t: title, n: row.visit_count }] });
}

function query(profile: string, maxUrls: number, maxVisits: number) {
  const db = savedDatabase(profile);
  const urls = db.prepare("SELECT id, url, title, visit_count FROM urls WHERE last_visit > 0 ORDER BY last_visit DESC LIMIT ?").all(maxUrls) as UrlRow[];
  const visits = db.prepare("SELECT at FROM visits WHERE url_id = ? ORDER BY at DESC LIMIT ?");
  const entries = transaction(db, () =>
    urls.map((row) => {
      const times = (visits.all(row.id, maxVisits) as { at: number }[]).map((v) => Math.floor(v.at)).reverse();
      return { u: row.url, t: row.title, n: row.visit_count, v: times };
    }),
  );
  return { entries };
}

type AddedPage = { u?: unknown; t?: unknown; v?: unknown };

function missingVisits(have: number[], wanted: number[], tolerance: number): number[] {
  const times = [...have].sort((a, b) => a - b);
  const used = times.map(() => false);
  const missing: number[] = [];
  let from = 0;
  for (const t of [...wanted].sort((a, b) => a - b)) {
    while (from < times.length && times[from]! < t - tolerance) from++;
    let match = from;
    while (match < times.length && times[match]! <= t + tolerance && used[match]) match++;
    if (match < times.length && times[match]! <= t + tolerance) used[match] = true;
    else missing.push(t);
  }
  return missing;
}

function add(profile: string, pages: AddedPage[], toleranceMs: number) {
  const db = savedDatabase(profile);
  const tolerance = Math.max(0, toleranceMs);
  const changes: Change[] = [];
  const added = transaction(db, () => {
    let count = 0;
    for (const page of pages) {
      if (typeof page.u !== "string" || !canAddToHistory(page.u) || !Array.isArray(page.v)) continue;
      const wanted = page.v.filter((at): at is number => typeof at === "number" && Number.isFinite(at));
      if (!wanted.length) continue;
      const title = typeof page.t === "string" ? page.t : "";
      const known = urlRow(db, page.u);
      const have = known ? (db.prepare("SELECT at FROM visits WHERE url_id = ?").all(known.id) as { at: number }[]).map((v) => v.at) : [];
      const missing = missingVisits(have, wanted, tolerance);
      if (!missing.length) continue;
      const row = known ?? ensureUrl(db, page.u, title);
      missing.forEach((at, i) => {
        addVisit(db, row, at, i === missing.length - 1 && !known?.title ? title : "");
        changes.push({ kind: "visit", u: row.url, t: row.title, n: row.visit_count, at: Math.floor(at) });
        count++;
      });
    }
    return count;
  });
  for (const change of changes) changed(profile, change);
  return { added };
}

type ImportedRow = { u?: unknown; t?: unknown; n?: unknown; l?: unknown };

function importRows(profile: string, rows: ImportedRow[]) {
  const db = savedDatabase(profile);
  const modified: WireRow[] = [];
  transaction(db, () => {
    for (const row of rows) {
      const last = typeof row.l === "number" ? row.l : 0;
      if (typeof row.u !== "string" || !canAddToHistory(row.u) || last <= 0) continue;
      const title = typeof row.t === "string" ? row.t : "";
      const count = Math.max(1, typeof row.n === "number" ? Math.floor(row.n) : 1);
      const known = urlRow(db, row.u);
      if (known) {
        const nextTitle = title || known.title;
        db.prepare("UPDATE urls SET title = ?, visit_count = MAX(visit_count, ?), last_visit = MAX(last_visit, ?) WHERE id = ?").run(nextTitle, count, last, known.id);
        if (last > known.last_visit) db.prepare("INSERT INTO visits (url_id, at) VALUES (?, ?)").run(known.id, last);
        modified.push({ u: row.u, t: nextTitle, n: Math.max(known.visit_count, count) });
        continue;
      }
      const { lastInsertRowid } = db.prepare("INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, ?, ?)").run(row.u, title, count, last);
      db.prepare("INSERT INTO visits (url_id, at) VALUES (?, ?)").run(Number(lastInsertRowid), last);
      modified.push({ u: row.u, t: title, n: count });
    }
  });
  if (modified.length) changed(profile, { kind: "modified", rows: modified });
  return {};
}

function deleteUrls(profile: string, urls: unknown[]) {
  const db = savedDatabase(profile);
  const valid = urls.filter((url): url is string => typeof url === "string");
  const gone = transaction(db, () => {
    const out: string[] = [];
    for (const url of valid) if (db.prepare("DELETE FROM urls WHERE url = ?").run(url).changes) out.push(url);
    return out;
  });
  changed(profile, { kind: "deleted", all: false, urls: gone });
  return {};
}

export function deleteHistorySince(profile: string, since: number) {
  const db = savedDatabase(profile);
  transaction(db, () => {
    if (since > 0) {
      db.prepare("DELETE FROM visits WHERE at >= ?").run(since);
      db.exec(`UPDATE urls SET
          visit_count = (SELECT COUNT(*) FROM visits WHERE visits.url_id = urls.id),
          last_visit = COALESCE((SELECT MAX(at) FROM visits WHERE visits.url_id = urls.id), 0)`);
      db.exec("DELETE FROM urls WHERE visit_count = 0");
    } else {
      db.exec("DELETE FROM visits; DELETE FROM urls;");
    }
  });
  changed(profile, { kind: "deleted", all: true, urls: [] });
}

function expireOld(profile: string) {
  const db = database(profile);
  const before = Date.now() - KEEP_MS;
  transaction(db, () => {
    if (!db.prepare("DELETE FROM visits WHERE at < ?").run(before).changes) return;
    db.exec("DELETE FROM urls WHERE NOT EXISTS (SELECT 1 FROM visits WHERE visits.url_id = urls.id)");
  });
}

defineDomain("history", {
  query: (args, profile) =>
    query(profile, typeof args.maxUrls === "number" ? args.maxUrls : DEFAULT_MAX_URLS, typeof args.maxVisits === "number" ? args.maxVisits : DEFAULT_MAX_VISITS),
  add: (args, profile) => add(profile, Array.isArray(args.pages) ? (args.pages as AddedPage[]) : [], typeof args.toleranceMs === "number" ? args.toleranceMs : 1000),
  import: (args, profile) => importRows(profile, Array.isArray(args.rows) ? (args.rows as ImportedRow[]) : []),
  deleteUrls: (args, profile) => deleteUrls(profile, Array.isArray(args.urls) ? args.urls : []),
  watch: (_args, profile) => {
    savedDatabase(profile);
    return null;
  },
});

onProfileOpened((profile) => {
  try {
    expireOld(profile);
  } catch (error) {
    console.warn("[ardia history] couldn't expire old visits", error);
  }
});

const lastUrlOfTab = new Map<string, string>();

onPage((event) => {
  if (event.type === "closed") return void lastUrlOfTab.delete(event.tabId);
  if (isPrivateProfile(event.profile)) return;
  try {
    if (event.type === "navigated") {
      if (!event.isMainFrame) return;
      const previous = lastUrlOfTab.get(event.tabId);
      lastUrlOfTab.set(event.tabId, event.url);
      if (RELOAD.test(event.transition) || previous === event.url) return;
      recordVisit(event.profile, event.url, event.title);
    } else if (event.type === "title") {
      recordTitle(event.profile, event.url, event.title);
    }
  } catch (error) {
    console.warn("[ardia history] couldn't record a page", error);
  }
});
