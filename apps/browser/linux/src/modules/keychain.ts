import { safeStorage } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineModule } from "../bridge";
import { note } from "../log";
import { dataDirectory } from "../paths";
import { writeDocument } from "./documents";

const FILE = "Secrets.json";
type Stored = { backend: string; sealed: boolean; value: string };

let cache: Record<string, Stored> | null = null;

function load(): Record<string, Stored> {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(join(dataDirectory(), FILE), "utf8")) as Record<string, Stored>;
  } catch {
    cache = {};
  }
  return cache;
}

const persist = () => writeDocument(FILE, JSON.stringify(load()));

const backend = () => {
  try {
    return safeStorage.getSelectedStorageBackend();
  } catch {
    return "unknown";
  }
};

export function sealSecret(secret: string): Stored {
  if (safeStorage.isEncryptionAvailable()) return { backend: backend(), sealed: true, value: safeStorage.encryptString(secret).toString("base64") };
  return { backend: "none", sealed: false, value: Buffer.from(secret, "utf8").toString("base64") };
}

export function openSecret(stored: Stored): string | null {
  try {
    if (!stored.sealed) return Buffer.from(stored.value, "base64").toString("utf8");
    return safeStorage.decryptString(Buffer.from(stored.value, "base64"));
  } catch (error) {
    note("keychain", `a secret couldn't be opened (${stored.backend}): ${String(error)}`);
    return null;
  }
}

async function get(account: string): Promise<string | null> {
  const stored = load()[account];
  return stored ? openSecret(stored) : null;
}

async function set(account: string, secret: string): Promise<boolean> {
  load()[account] = sealSecret(String(secret));
  persist();
  return true;
}

async function remove(account: string): Promise<boolean> {
  const secrets = load();
  if (!(account in secrets)) return true;
  delete secrets[account];
  persist();
  return true;
}

defineModule("ArdiaKeychain", {
  async: { get, set, delete: remove, backend: async () => backend() },
});
