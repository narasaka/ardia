import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join as joinPath, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveAddress, saveCard } from "../autofill";
import { sessionFor } from "../profiles";
import { findBrowser } from "./browsers";
import { chromiumKeys, decryptChromium, type ChromiumKeys } from "./chromiumKeys";
import { decryptLoginField, firefoxKey } from "./firefoxKeys";
import type { Answer, Cell, Entry, FirefoxLoginRead, ImportHost, Query, Rows, SnapshotFailure } from "./host";
import { fromUnixMicros, fromWebKit, type Credential, type WrittenCounts } from "./model";

type Snapshot = { db: DatabaseSync; folder: string };
type ImportedCookie = { url: string; name: string; value: string; domain?: string; path: string; secure: boolean; httpOnly: boolean; expirationDate?: number; sameSite: "unspecified" | "no_restriction" | "lax" | "strict" };
type ImportedAddress = Record<string, string>;
type ImportedCard = { name?: string; expMonth?: number; expYear?: number; number: string };
type Vault = { cookies: ImportedCookie[]; addresses: ImportedAddress[]; cards: ImportedCard[] };

const SAME_SITE: ImportedCookie["sameSite"][] = ["no_restriction", "lax", "strict"];
const COOKIE_HASH_PREFIX_VERSION = 24;
const COOKIE_HASH_BYTES = 32;

function failureOf(error: unknown): SnapshotFailure {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "missing";
  if (code === "EBUSY" || code === "SQLITE_BUSY") return "inUse";
  return "unreadable";
}

function cellOf(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString("base64") };
  return String(value);
}

function run(db: DatabaseSync, queries: Query[]): Answer {
  const results: Rows[] = queries.map((query) => {
    try {
      const statement = db.prepare(query.sql);
      statement.setReadBigInts(true);
      const columns = statement.columns().map((column) => column.name);
      const rows: Cell[][] = [];
      for (const row of statement.iterate(...(query.args ?? [])) as Iterable<Record<string, unknown>>) {
        rows.push(columns.map((column) => cellOf(row[column])));
        if (query.limit !== undefined && rows.length >= query.limit) break;
      }
      return { columns, rows };
    } catch (error) {
      return { columns: [], rows: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { results };
}

function snapshot(path: string): Snapshot {
  statSync(path);
  const folder = mkdtempSync(joinPath(tmpdir(), "ardia-import-"));
  try {
    const copy = joinPath(folder, "db");
    copyFileSync(path, copy);
    for (const suffix of ["-wal", "-journal"]) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
    const db = new DatabaseSync(copy);
    db.exec("PRAGMA query_only = ON");
    return { db, folder };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

function closeSnapshotOf(open: Snapshot) {
  try {
    open.db.close();
  } catch {}
  rmSync(open.folder, { recursive: true, force: true });
}

function withDb<Value>(path: string, use: (db: DatabaseSync) => Value): Value | { failure: SnapshotFailure } {
  let open: Snapshot;
  try {
    open = snapshot(path);
  } catch (error) {
    return { failure: failureOf(error) };
  }
  try {
    return use(open.db);
  } finally {
    closeSnapshotOf(open);
  }
}

function all(db: DatabaseSync, sql: string, ...args: (string | number)[]): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all(...args) as Record<string, unknown>[];
}

const hasTable = (db: DatabaseSync, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const text = (value: unknown) => (typeof value === "string" ? value : value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : "");
const num = (value: unknown) => (typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : 0);

function isWithin(folder: string, path: string): boolean {
  const base = resolve(folder);
  const full = resolve(base, path);
  return full === base || full.startsWith(`${base}/`);
}

function readLimited(path: string, largest: number): Buffer | null {
  try {
    if (statSync(path).size > largest) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}

export function nodeImportHost(): ImportHost & { usePrimaryPassword(password: string): void } {
  const snapshots = new Map<string, Snapshot>();
  const keys = new Map<string, ChromiumKeys>();
  let primaryPassword = "";
  const vaults = new Map<string, Vault>();

  const keysFor = (browserId: string) => {
    let found = keys.get(browserId);
    if (!found) {
      found = chromiumKeys(findBrowser(browserId)?.keyring);
      keys.set(browserId, found);
    }
    return found;
  };

  const vaultFor = (token: string) => {
    const id = token || randomUUID();
    if (!vaults.has(id)) vaults.set(id, { cookies: [], addresses: [], cards: [] });
    return { id, vault: vaults.get(id)! };
  };

  const host: ImportHost = {
    home: homedir(),

    async list(path) {
      try {
        return readdirSync(path, { withFileTypes: true }).map((entry): Entry => {
          let size = 0;
          let modified = 0;
          try {
            const stat = statSync(joinPath(path, entry.name));
            size = stat.size;
            modified = stat.mtimeMs;
          } catch {}
          return { name: entry.name, dir: entry.isDirectory(), size, modified };
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "EACCES" || code === "EPERM" ? { denied: true } : null;
      }
    },
    async readText(path, largest) {
      return readLimited(path, largest)?.toString("utf8") ?? null;
    },
    async readBase64(path, largest) {
      return readLimited(path, largest)?.toString("base64") ?? null;
    },
    async readTextWithin(folder, path, largest) {
      return isWithin(folder, path) ? (readLimited(resolve(folder, path), largest)?.toString("utf8") ?? null) : null;
    },
    async readBase64Within(folder, path, largest) {
      return isWithin(folder, path) ? (readLimited(resolve(folder, path), largest)?.toString("base64") ?? null) : null;
    },
    async query(path, queries) {
      return withDb(path, (db) => run(db, queries));
    },
    async openSnapshot(path) {
      try {
        const id = randomUUID();
        snapshots.set(id, snapshot(path));
        return { id };
      } catch (error) {
        return { failure: failureOf(error) };
      }
    },
    async querySnapshot(id, queries) {
      const open = snapshots.get(id);
      return open ? run(open.db, queries) : { failure: "closed" };
    },
    closeSnapshot(id) {
      const open = snapshots.get(id);
      snapshots.delete(id);
      if (open) closeSnapshotOf(open);
    },
    async unlock(browserId) {
      keysFor(browserId);
      return { unlocked: true, appBound: false };
    },
    async logins(browserId, files) {
      const browserKeys = keysFor(browserId);
      const items: Credential[] = [];
      const seen = new Set<string>();
      let undecryptable = 0;
      let appBound = 0;
      let failure: SnapshotFailure | undefined;
      for (const file of files) {
        const read = withDb(file, (db) =>
          all(db, "SELECT origin_url, username_value, password_value, signon_realm, date_created, date_last_used, times_used FROM logins WHERE blacklisted_by_user = 0"),
        );
        if ("failure" in read) {
          failure ??= read.failure;
          continue;
        }
        for (const row of read) {
          const url = text(row.origin_url) || text(row.signon_realm);
          const username = text(row.username_value);
          const decrypted = decryptChromium(row.password_value as Uint8Array | null, browserKeys);
          if (decrypted.value === null) {
            if (decrypted.reason === "appBound") appBound++;
            else undecryptable++;
            continue;
          }
          const key = `${url}\n${username}`;
          if (!url || seen.has(key)) continue;
          seen.add(key);
          const created = fromWebKit(num(row.date_created));
          const lastUsed = fromWebKit(num(row.date_last_used));
          items.push({
            url,
            username,
            password: decrypted.value.toString("utf8"),
            ...(text(row.signon_realm) ? { realm: text(row.signon_realm) } : {}),
            ...(created ? { created } : {}),
            ...(lastUsed ? { lastUsed } : {}),
            ...(num(row.times_used) ? { timesUsed: num(row.times_used) } : {}),
          });
        }
      }
      return { items, undecryptable, appBound, ...(failure ? { failure } : {}) };
    },
    async cookies(browserId, file) {
      const browserKeys = keysFor(browserId);
      const read = withDb(file, (db) => {
        const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string } | undefined)?.value ?? 0);
        const rows = all(db, "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite, has_expires FROM cookies");
        return { version, rows };
      });
      if ("failure" in read) return { count: 0, dropped: 0, undecryptable: 0, appBound: 0, failure: read.failure };
      const { id, vault } = vaultFor("");
      let undecryptable = 0;
      let appBound = 0;
      let dropped = 0;
      const now = Date.now() / 1000;
      for (const row of read.rows) {
        let value = text(row.value);
        if (!value) {
          const decrypted = decryptChromium(row.encrypted_value as Uint8Array | null, browserKeys);
          if (decrypted.value === null) {
            if (decrypted.reason === "appBound") appBound++;
            else undecryptable++;
            continue;
          }
          const plain = read.version >= COOKIE_HASH_PREFIX_VERSION && decrypted.value.length >= COOKIE_HASH_BYTES && row.encrypted_value ? decrypted.value.subarray(COOKIE_HASH_BYTES) : decrypted.value;
          value = plain.toString("utf8");
        }
        const hostKey = text(row.host_key);
        const expires = num(row.has_expires) ? fromWebKit(num(row.expires_utc)) : undefined;
        if (!hostKey || (expires !== undefined && expires / 1000 < now)) {
          dropped++;
          continue;
        }
        const secure = !!num(row.is_secure);
        const bare = hostKey.replace(/^\./, "");
        vault.cookies.push({
          url: `${secure ? "https" : "http"}://${bare}${text(row.path) || "/"}`,
          name: text(row.name),
          value,
          ...(hostKey.startsWith(".") ? { domain: hostKey } : {}),
          path: text(row.path) || "/",
          secure,
          httpOnly: !!num(row.is_httponly),
          ...(expires !== undefined ? { expirationDate: expires / 1000 } : {}),
          sameSite: SAME_SITE[num(row.samesite)] ?? "unspecified",
        });
      }
      return { count: vault.cookies.length, dropped, undecryptable, appBound, token: id };
    },
    async firefoxLogins(profile) {
      const empty: FirefoxLoginRead = { items: [], undecryptable: 0, appBound: 0 };
      const json = readLimited(joinPath(profile, "logins.json"), 64 << 20);
      if (!json) return { ...empty, error: { code: "notFound", message: "No saved passwords in this profile" } };
      const key = withDb(joinPath(profile, "key4.db"), (db) => firefoxKey(db, primaryPassword));
      if ("failure" in key) return { ...empty, failure: key.failure };
      if ("locked" in key) return { ...empty, error: { code: "locked", message: "Firefox's primary password protects these passwords" } };
      if ("error" in key) return { ...empty, error: { code: "unreadable", message: key.error } };
      let logins: Record<string, unknown>[] = [];
      try {
        logins = ((JSON.parse(json.toString("utf8")) as { logins?: Record<string, unknown>[] }).logins ?? []).filter((login) => login && typeof login === "object");
      } catch {
        return { ...empty, error: { code: "unreadable", message: "logins.json isn't readable" } };
      }
      let undecryptable = 0;
      const items: Credential[] = [];
      for (const login of logins) {
        try {
          const created = fromUnixMicros(num(login.timeCreated) * 1000);
          const lastUsed = fromUnixMicros(num(login.timeLastUsed) * 1000);
          items.push({
            url: text(login.hostname),
            username: decryptLoginField(text(login.encryptedUsername), key.key),
            password: decryptLoginField(text(login.encryptedPassword), key.key),
            ...(text(login.httpRealm) ? { realm: text(login.httpRealm) } : {}),
            ...(created ? { created } : {}),
            ...(lastUsed ? { lastUsed } : {}),
            ...(num(login.timesUsed) ? { timesUsed: num(login.timesUsed) } : {}),
          });
        } catch {
          undecryptable++;
        }
      }
      return { items, undecryptable, appBound: 0 };
    },
    async firefoxCookies(file) {
      const read = withDb(file, (db) => all(db, "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies"));
      if ("failure" in read) return { count: 0, dropped: 0, undecryptable: 0, appBound: 0, failure: read.failure };
      const { id, vault } = vaultFor("");
      let skipped = 0;
      let dropped = 0;
      const now = Date.now() / 1000;
      const sameSite: ImportedCookie["sameSite"][] = ["no_restriction", "lax", "strict"];
      for (const row of read) {
        if (text(row.originAttributes)) {
          skipped++;
          continue;
        }
        const hostKey = text(row.host);
        const expiry = num(row.expiry);
        const expires = expiry > 1e11 ? expiry / 1000 : expiry;
        if (!hostKey || (expires && expires < now)) {
          dropped++;
          continue;
        }
        const secure = !!num(row.isSecure);
        vault.cookies.push({
          url: `${secure ? "https" : "http"}://${hostKey.replace(/^\./, "")}${text(row.path) || "/"}`,
          name: text(row.name),
          value: text(row.value),
          ...(hostKey.startsWith(".") ? { domain: hostKey } : {}),
          path: text(row.path) || "/",
          secure,
          httpOnly: !!num(row.isHttpOnly),
          ...(expires ? { expirationDate: expires } : {}),
          sameSite: sameSite[num(row.sameSite)] ?? "unspecified",
        });
      }
      return { count: vault.cookies.length, dropped, undecryptable: 0, appBound: 0, skipped, token: id };
    },
    async autofill(browserId, file, joinToken) {
      const browserKeys = keysFor(browserId);
      const read = withDb(file, (db) => {
        const addresses: ImportedAddress[] = [];
        if (hasTable(db, "addresses") && hasTable(db, "address_type_tokens")) {
          const tokens = db.prepare("SELECT guid, type, value FROM address_type_tokens").all() as { guid: string; type: number; value: string }[];
          const byGuid = new Map<string, Map<number, string>>();
          for (const token of tokens) {
            if (!byGuid.has(token.guid)) byGuid.set(token.guid, new Map());
            byGuid.get(token.guid)!.set(token.type, text(token.value));
          }
          const field: Record<string, number[]> = { name: [7], organization: [60], street: [77], city: [33], state: [34], postalCode: [35], country: [36], phone: [14], email: [9] };
          for (const values of byGuid.values()) {
            const address: ImportedAddress = {};
            for (const [key, types] of Object.entries(field)) {
              const found = types.map((type) => values.get(type)).find(Boolean);
              if (found) address[key] = found;
            }
            if (Object.keys(address).length) addresses.push(address);
          }
        } else if (hasTable(db, "autofill_profiles")) {
          const rows = all(db, "SELECT guid, company_name, street_address, city, state, zipcode, country_code FROM autofill_profiles");
          const first = (table: string, column: string, guid: string) =>
            hasTable(db, table) ? text((db.prepare(`SELECT ${column} AS value FROM ${table} WHERE guid = ? LIMIT 1`).get(guid) as { value?: unknown } | undefined)?.value) : "";
          for (const row of rows) {
            const guid = text(row.guid);
            const address: ImportedAddress = {};
            const entries: [string, string][] = [
              ["name", first("autofill_profile_names", "full_name", guid)],
              ["organization", text(row.company_name)],
              ["street", text(row.street_address)],
              ["city", text(row.city)],
              ["state", text(row.state)],
              ["postalCode", text(row.zipcode)],
              ["country", text(row.country_code)],
              ["phone", first("autofill_profile_phones", "number", guid)],
              ["email", first("autofill_profile_emails", "email", guid)],
            ];
            for (const [key, value] of entries) if (value) address[key] = value;
            if (Object.keys(address).length) addresses.push(address);
          }
        }
        const cards: ImportedCard[] = [];
        let undecryptable = 0;
        let appBound = 0;
        if (hasTable(db, "credit_cards")) {
          const rows = all(db, "SELECT name_on_card, expiration_month, expiration_year, card_number_encrypted FROM credit_cards");
          for (const row of rows) {
            const decrypted = decryptChromium(row.card_number_encrypted as Uint8Array | null, browserKeys);
            if (decrypted.value === null) {
              if (decrypted.reason === "appBound") appBound++;
              else undecryptable++;
              continue;
            }
            const number = decrypted.value.toString("utf8").replace(/\D/g, "");
            if (number.length < 12) continue;
            cards.push({
              ...(text(row.name_on_card) ? { name: text(row.name_on_card) } : {}),
              ...(num(row.expiration_month) ? { expMonth: num(row.expiration_month) } : {}),
              ...(num(row.expiration_year) ? { expYear: num(row.expiration_year) } : {}),
              number,
            });
          }
        }
        return { addresses, cards, undecryptable, appBound };
      });
      if ("failure" in read) return { addresses: 0, cards: 0, lockedCards: 0, undecryptable: 0, appBound: 0, failure: read.failure };
      const { id, vault } = vaultFor(joinToken);
      vault.addresses.push(...read.addresses);
      vault.cards.push(...read.cards);
      return { addresses: read.addresses.length, cards: read.cards.length, lockedCards: 0, undecryptable: read.undecryptable, appBound: read.appBound, token: id };
    },
    async writeImported(token, profile, kinds) {
      const vault = vaults.get(token);
      vaults.delete(token);
      const counts: WrittenCounts = { cookies: 0, cookiesRejected: 0, cookiesExisting: 0, addresses: 0, cards: 0 };
      if (!vault) return { ...counts, error: "nothing to write" };
      if (kinds.includes("cookies")) {
        const cookies = sessionFor(profile).cookies;
        for (const cookie of vault.cookies) {
          try {
            await cookies.set(cookie);
            counts.cookies++;
          } catch {
            counts.cookiesRejected++;
          }
        }
        await cookies.flushStore().catch(() => {});
      }
      if (kinds.includes("autofill")) {
        for (const address of vault.addresses) {
          try {
            saveAddress(profile, address);
            counts.addresses++;
          } catch {
            counts.autofillFailed = 1;
          }
        }
        for (const card of vault.cards) {
          try {
            saveCard(profile, { name: card.name, expMonth: card.expMonth, expYear: card.expYear }, card.number);
            counts.cards++;
          } catch {
            counts.autofillFailed = 1;
          }
        }
      }
      return counts;
    },
    discard(token) {
      vaults.delete(token);
    },
    forget() {
      keys.clear();
      primaryPassword = "";
    },
  };
  return Object.assign(host, {
    usePrimaryPassword(password: string) {
      primaryPassword = password;
    },
  });
}
