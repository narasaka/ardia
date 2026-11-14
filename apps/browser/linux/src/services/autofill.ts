import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { defineModule } from "../bridge";
import { defineDomain } from "../engine/domains";
import { pref, savedDatabase, setPref, transaction } from "./database";
import { encryptionReady } from "./passwords";
import { engineError, originalProfile } from "./profiles";

const ADDRESS_FIELDS = ["name", "organization", "street", "city", "state", "postalCode", "country", "phone", "email"] as const;
const SETTINGS_PREF = "autofill.settings";

type Address = Partial<Record<(typeof ADDRESS_FIELDS)[number], string>>;
type CardRow = { id: string; name: string | null; network: string; last4: string; exp_month: number | null; exp_year: number | null; number: Uint8Array | null; created: number; modified: number };
type Settings = { addresses: boolean; cards: boolean };

const store = (profile: string): DatabaseSync => savedDatabase(originalProfile(profile));

export function cardNetwork(number: string): string {
  const digits = number.replace(/\D/g, "");
  const prefix = (length: number) => Number(digits.slice(0, length));
  if (/^4/.test(digits)) return "visa";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(5[1-5])/.test(digits) || (prefix(4) >= 2221 && prefix(4) <= 2720)) return "mastercard";
  if (/^(6011|65)/.test(digits) || (prefix(3) >= 644 && prefix(3) <= 649)) return "discover";
  if (/^(36|38|30[0-5])/.test(digits)) return "diners";
  if (/^35/.test(digits)) return "jcb";
  if (/^62/.test(digits)) return "unionpay";
  return "card";
}

function cleanAddress(input: unknown): Address {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: Address = {};
  for (const key of ADDRESS_FIELDS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function settingsOf(profile: string): Settings {
  return { addresses: true, cards: true, ...pref<Partial<Settings>>(store(profile), SETTINGS_PREF, {}) };
}

export function saveAddress(profile: string, input: unknown): string {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const address = cleanAddress(fields);
  if (!Object.keys(address).length) throw engineError("an address needs at least one field");
  const db = store(profile);
  const now = Date.now();
  const id = typeof fields.id === "string" && fields.id ? fields.id : randomUUID();
  db.prepare("INSERT INTO addresses (id, fields, created, modified) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET fields = excluded.fields, modified = excluded.modified").run(
    id,
    JSON.stringify(address),
    now,
    now,
  );
  return id;
}

export function addresses(profile: string) {
  const rows = store(profile).prepare("SELECT * FROM addresses ORDER BY modified DESC").all() as { id: string; fields: string; created: number; modified: number }[];
  return rows.map((row) => ({ id: row.id, ...(JSON.parse(row.fields) as Address), created: Math.floor(row.created), modified: Math.floor(row.modified) }));
}

const month = (value: unknown) => (typeof value === "number" && value >= 1 && value <= 12 ? Math.floor(value) : null);
const year = (value: unknown) => (typeof value === "number" && value >= 1900 && value <= 9999 ? Math.floor(value) : null);

export function saveCard(profile: string, input: unknown, number: string | null): string {
  const card = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const db = store(profile);
  const now = Date.now();
  const digits = number?.replace(/\D/g, "") ?? "";
  return transaction(db, () => {
    const id = typeof card.id === "string" && card.id ? card.id : null;
    const existing = id ? (db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined) : undefined;
    if (!existing && digits.length < 12) throw engineError("a card needs its number");
    if (digits && !encryptionReady()) throw engineError("cards can't be encrypted on this system");
    const name = typeof card.name === "string" ? card.name.trim() || null : (existing?.name ?? null);
    const encrypted = digits ? safeStorage.encryptString(digits) : existing?.number ? Buffer.from(existing.number) : null;
    const row = {
      id: existing?.id ?? id ?? randomUUID(),
      network: digits ? cardNetwork(digits) : (existing?.network ?? "card"),
      last4: digits ? digits.slice(-4) : (existing?.last4 ?? ""),
      expMonth: card.expMonth === undefined ? (existing?.exp_month ?? null) : month(card.expMonth),
      expYear: card.expYear === undefined ? (existing?.exp_year ?? null) : year(card.expYear),
    };
    db.prepare(
      `INSERT INTO cards (id, name, network, last4, exp_month, exp_year, number, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, network = excluded.network, last4 = excluded.last4, exp_month = excluded.exp_month,
       exp_year = excluded.exp_year, number = excluded.number, modified = excluded.modified`,
    ).run(row.id, name, row.network, row.last4, row.expMonth, row.expYear, encrypted, existing?.created ?? now, now);
    return row.id;
  });
}

export function cards(profile: string) {
  const rows = store(profile).prepare("SELECT * FROM cards ORDER BY modified DESC").all() as CardRow[];
  return rows.map((row) => ({
    id: row.id,
    ...(row.name ? { name: row.name } : {}),
    network: row.network,
    last4: row.last4,
    ...(row.exp_month ? { expMonth: row.exp_month } : {}),
    ...(row.exp_year ? { expYear: row.exp_year } : {}),
    created: Math.floor(row.created),
    modified: Math.floor(row.modified),
  }));
}

export function cardNumber(profile: string, id: string): string | null {
  const row = store(profile).prepare("SELECT number FROM cards WHERE id = ?").get(id) as { number: Uint8Array | null } | undefined;
  if (!row?.number || !encryptionReady()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(row.number));
  } catch {
    return null;
  }
}

defineDomain("autofill", {
  settings: (_args, profile) => settingsOf(profile),
  setSettings: (args, profile) => {
    const next = settingsOf(profile);
    if (typeof args.addresses === "boolean") next.addresses = args.addresses;
    if (typeof args.cards === "boolean") next.cards = args.cards;
    setPref(store(profile), SETTINGS_PREF, next);
    return null;
  },
  addresses: (_args, profile) => ({ addresses: addresses(profile) }),
  saveAddress: (args, profile) => ({ id: saveAddress(profile, args.address) }),
  cards: (_args, profile) => ({ cards: cards(profile) }),
  remove: (args, profile) => {
    const id = typeof args.id === "string" ? args.id : "";
    const db = store(profile);
    db.prepare("DELETE FROM addresses WHERE id = ?").run(id);
    db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    return { ok: true };
  },
  cardNumber: (args, profile) => ({ number: cardNumber(profile, typeof args.id === "string" ? args.id : "") }),
  showSuggestions: () => false,
});

defineModule("ArdiaAutofill", {
  async: {
    saveCard: async (profile: string, card: unknown, number: string | null) => JSON.stringify({ id: saveCard(profile ?? "", card, typeof number === "string" ? number : null) }),
  },
});
