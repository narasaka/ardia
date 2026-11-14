import type { DatabaseSync } from "node:sqlite";
import { defineDomain } from "../engine/domains";
import { onPage } from "../engine/pages";
import { database, savedDatabase } from "./database";
import { pngSize, toPng } from "./images";
import { engineError, isPrivateProfile, sessionFor } from "./profiles";

const STORED_PIXELS = 64;
const MAX_PER_CALL = 500;
const LARGEST_ICON_BYTES = 1 << 20;
const FETCH_TIMEOUT_MS = 15_000;
const REFETCH_AFTER_MS = 7 * 86_400_000;
const PNG_DATA = "data:image/png;base64,";

type Stored = { icon: string; png: Uint8Array; width: number; height: number };

const withoutFragment = (url: string) => {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
};

const iconOf = (db: DatabaseSync, icon: string) => db.prepare("SELECT icon, png, width, height FROM favicons WHERE icon = ?").get(icon) as Stored | undefined;

function iconForPage(db: DatabaseSync, page: string): Stored | undefined {
  const mapped = db.prepare("SELECT f.icon, f.png, f.width, f.height FROM favicon_pages p JOIN favicons f ON f.icon = p.icon WHERE p.page = ?");
  const exact = (mapped.get(page) ?? mapped.get(withoutFragment(page))) as Stored | undefined;
  if (exact) return exact;
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const home = `${url.origin}/`;
  return (
    (mapped.get(home) as Stored | undefined) ??
    iconOf(db, `${url.origin}/favicon.ico`) ??
    (db
      .prepare("SELECT f.icon, f.png, f.width, f.height FROM favicon_pages p JOIN favicons f ON f.icon = p.icon WHERE p.page >= ? AND p.page < ? LIMIT 1")
      .get(home, `${url.origin}0`) as Stored | undefined)
  );
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function storeIcon(db: DatabaseSync, icon: string, png: Buffer, width: number, height: number) {
  db.prepare(
    "INSERT INTO favicons (icon, png, width, height, used) VALUES (?, ?, ?, ?, ?) ON CONFLICT(icon) DO UPDATE SET png = excluded.png, width = excluded.width, height = excluded.height, used = excluded.used",
  ).run(icon, png, width, height, Date.now());
}

function mapPage(db: DatabaseSync, page: string, icon: string) {
  db.prepare("INSERT INTO favicon_pages (page, icon) VALUES (?, ?) ON CONFLICT(page) DO UPDATE SET icon = excluded.icon").run(withoutFragment(page), icon);
}

const inFlight = new Map<string, Promise<{ png: Buffer; width: number; height: number } | null>>();

function download(profile: string, icon: string) {
  const key = `${profile}\n${icon}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = (async () => {
    if (icon.startsWith("data:")) {
      const comma = icon.indexOf(",");
      if (comma < 0) return null;
      const meta = icon.slice(5, comma);
      const body = icon.slice(comma + 1);
      const bytes = meta.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
      return toPng(bytes, meta.replace(/;base64$/, ""), STORED_PIXELS);
    }
    if (!/^https?:\/\//i.test(icon)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await sessionFor(profile).fetch(icon, { signal: controller.signal, credentials: "include" });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > LARGEST_ICON_BYTES) return null;
      return toPng(bytes, response.headers.get("content-type") ?? "", STORED_PIXELS);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  inFlight.set(key, work);
  void work.finally(() => inFlight.delete(key));
  return work;
}

async function fetchIcon(profile: string, url: string) {
  if (url.startsWith(PNG_DATA)) {
    const png = Buffer.from(url.slice(PNG_DATA.length), "base64");
    const size = pngSize(png);
    return size?.width && size.height ? { uri: url, ...size } : null;
  }
  if (isPrivateProfile(profile) || !/^https?:\/\//i.test(url)) return null;
  const db = savedDatabase(profile);
  const known = iconOf(db, url);
  if (known) return { uri: PNG_DATA + base64(known.png), width: known.width, height: known.height };
  const image = await download(profile, url);
  if (!image) return null;
  storeIcon(db, url, image.png, image.width, image.height);
  return { uri: PNG_DATA + image.png.toString("base64"), width: image.width, height: image.height };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_PER_CALL) : [];
}

defineDomain("favicons", {
  get: (args, profile) => {
    const db = savedDatabase(profile);
    const pages: Record<string, { png: string; icon: string }> = {};
    const icons: Record<string, { png: string }> = {};
    const used = new Set<string>();
    for (const page of strings(args.pages)) {
      const found = iconForPage(db, page);
      if (!found) continue;
      pages[page] = { png: base64(found.png), icon: found.icon };
      used.add(found.icon);
    }
    for (const icon of strings(args.icons)) {
      const found = iconOf(db, icon);
      if (!found) continue;
      icons[icon] = { png: base64(found.png) };
      used.add(icon);
    }
    const touch = db.prepare("UPDATE favicons SET used = ? WHERE icon = ?");
    const now = Date.now();
    for (const icon of used) touch.run(now, icon);
    return { pages, icons };
  },
  set: (args, profile) => {
    const db = savedDatabase(profile);
    const page = typeof args.page === "string" ? args.page : "";
    const icon = typeof args.icon === "string" ? args.icon : "";
    const png = Buffer.from(typeof args.png === "string" ? args.png : "", "base64");
    const size = pngSize(png);
    if (!page || !icon || !png.length) throw engineError("bad arguments");
    if (!size?.width || !size.height) throw engineError("not a PNG");
    storeIcon(db, icon, png, size.width, size.height);
    mapPage(db, page, icon);
    return { stored: true };
  },
  fetch: (args, profile) => fetchIcon(profile, typeof args.url === "string" ? args.url : ""),
});

const pickIcon = (icons: string[]) => icons.find((icon) => /^https?:\/\//i.test(icon)) ?? icons.find((icon) => icon.startsWith("data:image/"));

async function pageIcon(profile: string, page: string, icons: string[]) {
  const icon = pickIcon(icons);
  if (!icon || !/^(https?|file):/i.test(page)) return;
  const db = database(profile);
  const known = db.prepare("SELECT used FROM favicons WHERE icon = ?").get(icon) as { used: number } | undefined;
  if (!known || Date.now() - known.used > REFETCH_AFTER_MS) {
    const image = await download(profile, icon);
    if (!image) return;
    storeIcon(db, icon, image.png, image.width, image.height);
  }
  mapPage(db, page, icon);
}

onPage((event) => {
  if (event.type !== "favicon" || isPrivateProfile(event.profile)) return;
  pageIcon(event.profile, event.url, event.icons).catch((error: unknown) => console.warn("[ardia favicons] couldn't store a page's icon", error));
});
