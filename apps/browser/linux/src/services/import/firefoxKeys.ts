import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type Der = { tag: number; body: Buffer; children: Der[] };

const SEQUENCE = 0x30;
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBE_SHA1_3DES = "1.2.840.113549.1.12.5.1.3";
const OID_3DES = "1.2.840.113549.3.7";
const OID_AES256 = "2.16.840.1.101.3.4.1.42";
const PASSWORD_CHECK = "password-check";

function parse(buffer: Buffer, at = 0): [Der, number] {
  const tag = buffer[at]!;
  let length = buffer[at + 1]!;
  let start = at + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + buffer[start + i]!;
    start += bytes;
  }
  const body = buffer.subarray(start, start + length);
  const children: Der[] = [];
  if (tag === SEQUENCE || tag === 0x31 || tag === 0xa0) {
    let inner = 0;
    while (inner < body.length) {
      const [child, next] = parse(body, inner);
      children.push(child);
      inner = next;
    }
  }
  return [{ tag, body, children }, start + length];
}

const der = (buffer: Buffer) => parse(buffer)[0];

function oid(node: Der): string {
  const bytes = node.body;
  const parts = [Math.floor(bytes[0]! / 40), bytes[0]! % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

const integer = (node: Der) => node.body.reduce((value, byte) => value * 256 + byte, 0);

function unpad(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1] ?? 0;
  return pad > 0 && pad <= 16 ? buffer.subarray(0, buffer.length - pad) : buffer;
}

function decipher(algorithm: string, key: Buffer, iv: Buffer, data: Buffer): Buffer {
  const decryptor = createDecipheriv(algorithm, key, iv);
  decryptor.setAutoPadding(false);
  return unpad(Buffer.concat([decryptor.update(data), decryptor.final()]));
}

function decryptPbe(encoded: Buffer, globalSalt: Buffer, primaryPassword: string): Buffer {
  const root = der(encoded);
  const [algorithm, cipherText] = root.children;
  const scheme = oid(algorithm!.children[0]!);
  if (scheme === OID_PBES2) {
    const [kdf, cipher] = algorithm!.children[1]!.children;
    const kdfParams = kdf!.children[1]!.children;
    const salt = kdfParams[0]!.body;
    const iterations = integer(kdfParams[1]!);
    const keyLength = kdfParams[2]?.tag === 0x02 ? integer(kdfParams[2]) : 32;
    const password = createHash("sha1").update(globalSalt).update(primaryPassword).digest();
    const key = pbkdf2Sync(password, salt, iterations, keyLength, "sha256");
    const iv = Buffer.concat([Buffer.from([0x04, 0x0e]), cipher!.children[1]!.body]);
    return decipher("aes-256-cbc", key, iv, cipherText!.body);
  }
  if (scheme === OID_PBE_SHA1_3DES) {
    const params = algorithm!.children[1]!.children;
    const entrySalt = params[0]!.body;
    const hashedPassword = createHash("sha1").update(globalSalt).update(primaryPassword).digest();
    const combined = createHash("sha1").update(hashedPassword).update(entrySalt).digest();
    const paddedSalt = Buffer.concat([entrySalt, Buffer.alloc(20 - Math.min(20, entrySalt.length))]);
    const hmac = (key: Buffer, data: Buffer) => createHmac("sha1", key).update(data).digest();
    const k1 = hmac(combined, Buffer.concat([paddedSalt, entrySalt]));
    const tk = hmac(combined, paddedSalt);
    const k2 = hmac(combined, Buffer.concat([tk, entrySalt]));
    const k = Buffer.concat([k1, k2]);
    return decipher("des-ede3-cbc", k.subarray(0, 24), k.subarray(32, 40), cipherText!.body);
  }
  throw new Error(`unsupported key protection ${scheme}`);
}

export type FirefoxKey = { key: Buffer } | { locked: true } | { error: string };

export function firefoxKey(db: DatabaseSync, primaryPassword = ""): FirefoxKey {
  const meta = db.prepare("SELECT item1, item2 FROM metadata WHERE id = 'password'").get() as { item1: Uint8Array; item2: Uint8Array } | undefined;
  if (!meta) return { error: "key4.db has no password entry" };
  const globalSalt = Buffer.from(meta.item1);
  let check: Buffer;
  try {
    check = decryptPbe(Buffer.from(meta.item2), globalSalt, primaryPassword);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!check.toString("latin1").startsWith(PASSWORD_CHECK)) return { locked: true };
  const rows = db.prepare("SELECT a11 FROM nssPrivate").all() as { a11: Uint8Array | null }[];
  for (const row of rows) {
    if (!row.a11) continue;
    try {
      return { key: decryptPbe(Buffer.from(row.a11), globalSalt, primaryPassword) };
    } catch {}
  }
  return { error: "key4.db has no usable key" };
}

export function decryptLoginField(base64: string, key: Buffer): string {
  const root = der(Buffer.from(base64, "base64"));
  const [, algorithm, cipherText] = root.children;
  const scheme = oid(algorithm!.children[0]!);
  const iv = algorithm!.children[1]!.body;
  if (scheme === OID_3DES) return decipher("des-ede3-cbc", key.subarray(0, 24), iv, cipherText!.body).toString("utf8");
  if (scheme === OID_AES256) return decipher("aes-256-cbc", key.subarray(0, 32), iv, cipherText!.body).toString("utf8");
  throw new Error(`unsupported login cipher ${scheme}`);
}
