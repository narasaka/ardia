import { spawnSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

const SALT = "saltysalt";
const IV = Buffer.alloc(16, 0x20);
const BUILT_IN_PASSWORD = "peanuts";
const LOOKUP_TIMEOUT_MS = 5000;
const KWALLET_NAMES: Record<string, string> = { chrome: "Chrome", chromium: "Chromium", brave: "Brave", "Microsoft Edge": "Microsoft Edge", vivaldi: "Vivaldi", opera: "Opera" };

export type ChromiumKeys = { v10: Buffer[]; v11: Buffer[] };

const keyOf = (password: string) => pbkdf2Sync(password, SALT, 1, 16, "sha1");

function run(command: string, args: string[]): string | null {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: LOOKUP_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    const out = result.status === 0 ? result.stdout.replace(/\n$/, "") : "";
    return out || null;
  } catch {
    return null;
  }
}

function keyringPassword(application: string): string | null {
  const secret = run("secret-tool", ["lookup", "application", application]);
  if (secret) return secret;
  const wallet = KWALLET_NAMES[application];
  if (!wallet) return null;
  for (const name of ["kdewallet"]) {
    const found = run("kwallet-query", ["-r", `${wallet} Safe Storage`, "-f", `${wallet} Keys`, name]);
    if (found && !/failed|not found/i.test(found)) return found;
  }
  return null;
}

export function chromiumKeys(application: string | undefined): ChromiumKeys {
  const stored = application ? keyringPassword(application) : null;
  return { v10: [keyOf(BUILT_IN_PASSWORD), keyOf("")], v11: [...(stored ? [keyOf(stored)] : []), keyOf("")] };
}

export const hasKeyringKey = (keys: ChromiumKeys) => keys.v11.length > 1;

function decryptWith(key: Buffer, body: Buffer): Buffer | null {
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
}

export type Decrypted = { value: Buffer } | { value: null; reason: "undecryptable" | "appBound" };

export function decryptChromium(blob: Uint8Array | null | undefined, keys: ChromiumKeys): Decrypted {
  if (!blob || !blob.length) return { value: Buffer.alloc(0) };
  const bytes = Buffer.from(blob);
  const prefix = bytes.subarray(0, 3).toString("latin1");
  if (prefix === "v20") return { value: null, reason: "appBound" };
  if (prefix !== "v10" && prefix !== "v11") return { value: bytes };
  const body = bytes.subarray(3);
  for (const key of prefix === "v10" ? keys.v10 : keys.v11) {
    const value = decryptWith(key, body);
    if (value) return { value };
  }
  return { value: null, reason: "undecryptable" };
}
