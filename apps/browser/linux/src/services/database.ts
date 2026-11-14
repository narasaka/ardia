import { app } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { emitDomainEvent } from "../engine/domains";
import { engineError, isPrivateProfile, profileDirectory } from "./profiles";

const SCHEMA: string[] = [
  `CREATE TABLE urls (
     id INTEGER PRIMARY KEY,
     url TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL DEFAULT '',
     visit_count INTEGER NOT NULL DEFAULT 0,
     last_visit REAL NOT NULL DEFAULT 0
   );
   CREATE INDEX urls_last_visit ON urls(last_visit);
   CREATE TABLE visits (
     id INTEGER PRIMARY KEY,
     url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
     at REAL NOT NULL
   );
   CREATE INDEX visits_url ON visits(url_id, at);
   CREATE INDEX visits_at ON visits(at);
   CREATE TABLE favicons (
     icon TEXT PRIMARY KEY,
     png BLOB NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     used REAL NOT NULL
   );
   CREATE TABLE favicon_pages (
     page TEXT PRIMARY KEY,
     icon TEXT NOT NULL
   );
   CREATE INDEX favicon_pages_icon ON favicon_pages(icon);
   CREATE TABLE bookmarks (
     id TEXT PRIMARY KEY,
     parent TEXT,
     position INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     url TEXT,
     added REAL NOT NULL,
     key TEXT
   );
   CREATE INDEX bookmarks_parent ON bookmarks(parent, position);
   CREATE TABLE site_settings (
     origin TEXT NOT NULL,
     type TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (origin, type)
   );
   CREATE TABLE zoom_levels (
     host TEXT PRIMARY KEY,
     zoom REAL NOT NULL
   );
   CREATE TABLE logins (
     origin TEXT NOT NULL,
     username TEXT NOT NULL,
     password BLOB NOT NULL,
     action TEXT,
     created REAL NOT NULL,
     modified REAL NOT NULL,
     used REAL,
     PRIMARY KEY (origin, username)
   );
   CREATE TABLE never_save (
     origin TEXT PRIMARY KEY
   );
   CREATE TABLE addresses (
     id TEXT PRIMARY KEY,
     fields TEXT NOT NULL,
     created REAL NOT NULL,
     modified REAL NOT NULL
   );
   CREATE TABLE cards (
     id TEXT PRIMARY KEY,
     name TEXT,
     network TEXT NOT NULL,
     last4 TEXT NOT NULL,
     exp_month INTEGER,
     exp_year INTEGER,
     number BLOB,
     created REAL NOT NULL,
     modified REAL NOT NULL
   );
   CREATE TABLE prefs (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

export type Database = DatabaseSync;

const open = new Map<string, DatabaseSync>();
const loadListeners = new Set<(profile: string) => void>();

function migrate(db: DatabaseSync) {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let step = version; step < SCHEMA.length; step++) {
    transaction(db, () => {
      db.exec(SCHEMA[step]!);
      db.exec(`PRAGMA user_version = ${step + 1}`);
    });
  }
}

function openDatabase(profile: string): DatabaseSync {
  if (isPrivateProfile(profile)) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    return db;
  }
  const folder = profileDirectory(profile);
  mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(join(folder, "Ardia.sqlite"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000");
  migrate(db);
  return db;
}

export function database(profile: string): DatabaseSync {
  let db = open.get(profile);
  if (db) return db;
  db = openDatabase(profile);
  open.set(profile, db);
  if (!isPrivateProfile(profile)) {
    for (const listener of loadListeners) listener(profile);
    emitDomainEvent("profiles.loaded", { profile });
  }
  return db;
}

export function savedDatabase(profile: string): DatabaseSync {
  if (isPrivateProfile(profile)) throw engineError("a private window keeps no saved data");
  return database(profile);
}

export const openProfiles = (): string[] => [...open.keys()].filter((profile) => !isPrivateProfile(profile));

export function onProfileOpened(listener: (profile: string) => void): () => void {
  loadListeners.add(listener);
  return () => void loadListeners.delete(listener);
}

export function closeDatabase(profile: string): void {
  const db = open.get(profile);
  if (!db) return;
  open.delete(profile);
  try {
    db.close();
  } catch {}
}

export function transaction<Value>(db: DatabaseSync, run: () => Value): Value {
  if (db.isTransaction) return run();
  db.exec("BEGIN");
  try {
    const value = run();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function pref<Value>(db: DatabaseSync, key: string, fallback: Value): Value {
  const row = db.prepare("SELECT value FROM prefs WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as Value;
  } catch {
    return fallback;
  }
}

export function setPref(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export type Row = Record<string, SQLInputValue>;

app.on("will-quit", () => {
  for (const profile of [...open.keys()]) closeDatabase(profile);
});
