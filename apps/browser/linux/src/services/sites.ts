import type { DatabaseSync } from "node:sqlite";
import { defineDomain } from "../engine/domains";
import { database, transaction } from "./database";
import { engineError, isPrivateProfile, sessionFor } from "./profiles";

export type SiteSettingType =
  | "popups" | "camera" | "microphone" | "location" | "notifications" | "sound" | "autoplay" | "javascript"
  | "images" | "clipboard" | "automaticDownloads" | "cookies" | "midi" | "sensors" | "windowManagement"
  | "localFonts" | "idleDetection" | "storageAccess" | "fileSystem" | "keyboardLock" | "pointerLock"
  | "cameraPanTiltZoom";
export type SiteSettingValue = "allow" | "block" | "ask";

export const SITE_SETTING_DEFAULTS: Record<SiteSettingType, SiteSettingValue> = {
  popups: "block",
  camera: "ask",
  microphone: "ask",
  location: "ask",
  notifications: "ask",
  sound: "allow",
  autoplay: "allow",
  javascript: "allow",
  images: "allow",
  clipboard: "ask",
  automaticDownloads: "ask",
  cookies: "allow",
  midi: "ask",
  sensors: "allow",
  windowManagement: "ask",
  localFonts: "ask",
  idleDetection: "ask",
  storageAccess: "ask",
  fileSystem: "ask",
  keyboardLock: "ask",
  pointerLock: "ask",
  cameraPanTiltZoom: "ask",
};

const VALUES = new Set(["allow", "block", "ask", "default"]);
const ZOOM_SAME = 1e-6;
const SITE_DATA: Electron.ClearDataOptions["dataTypes"] = ["backgroundFetch", "cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"];

const isType = (type: unknown): type is SiteSettingType => typeof type === "string" && Object.hasOwn(SITE_SETTING_DEFAULTS, type);

export function siteOrigin(spec: string): string | null {
  try {
    const url = new URL(spec);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originArg(args: Record<string, unknown>): string {
  const origin = typeof args.origin === "string" ? siteOrigin(args.origin) : null;
  if (!origin) throw engineError("origin must be an http(s) origin");
  return origin;
}

const exceptionOf = (db: DatabaseSync, origin: string, type: SiteSettingType) =>
  (db.prepare("SELECT value FROM site_settings WHERE origin = ? AND type = ?").get(origin, type) as { value: SiteSettingValue } | undefined)?.value;

type Listener = (change: { profile: string; origin: string | null; type: SiteSettingType | null }) => void;
const listeners = new Set<Listener>();

export function onSiteSettingChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const changed = (profile: string, origin: string | null, type: SiteSettingType | null) => {
  for (const listener of listeners) listener({ profile, origin, type });
};

export function siteSetting(profile: string, url: string, type: SiteSettingType): SiteSettingValue {
  const origin = siteOrigin(url);
  if (!origin) return SITE_SETTING_DEFAULTS[type];
  return exceptionOf(database(profile), origin, type) ?? SITE_SETTING_DEFAULTS[type];
}

export function rememberSiteSetting(profile: string, url: string, type: SiteSettingType, value: SiteSettingValue | "default"): void {
  const origin = siteOrigin(url);
  if (!origin) return;
  const db = database(profile);
  if (value === "default") db.prepare("DELETE FROM site_settings WHERE origin = ? AND type = ?").run(origin, type);
  else db.prepare("INSERT INTO site_settings (origin, type, value) VALUES (?, ?, ?) ON CONFLICT(origin, type) DO UPDATE SET value = excluded.value").run(origin, type, value);
  changed(profile, origin, type);
}

export function zoomFor(profile: string, host: string): number {
  const row = database(profile).prepare("SELECT zoom FROM zoom_levels WHERE host = ?").get(host.toLowerCase()) as { zoom: number } | undefined;
  return row?.zoom ?? 1;
}

export function clearSiteSettings(profile: string): void {
  const db = database(profile);
  db.exec("DELETE FROM site_settings; DELETE FROM zoom_levels;");
  changed(profile, null, null);
}

function hostVariants(origin: string): string[] {
  const { hostname, port } = new URL(origin);
  const suffix = port ? `:${port}` : "";
  return [`https://${hostname}${suffix}`, `http://${hostname}${suffix}`];
}

async function clearSiteData(profile: string, origin: string) {
  const session = sessionFor(profile);
  const host = new URL(origin).hostname;
  let cookies: number | false;
  try {
    cookies = (await session.cookies.get({ domain: host })).length;
  } catch {
    cookies = false;
  }
  try {
    await session.clearData({ dataTypes: SITE_DATA, origins: hostVariants(origin), originMatchingMode: "third-parties-included" });
    return { cookies, storage: true };
  } catch {
    return { cookies, storage: false };
  }
}

defineDomain("sites", {
  settings: (args, profile) => {
    const origin = originArg(args);
    const db = database(profile);
    const rows = db.prepare("SELECT type, value FROM site_settings WHERE origin = ?").all(origin) as { type: string; value: SiteSettingValue }[];
    const exceptions = new Map(rows.map((row) => [row.type, row.value]));
    return Object.fromEntries(
      (Object.keys(SITE_SETTING_DEFAULTS) as SiteSettingType[]).map((type) => {
        const value = exceptions.get(type);
        return [type, { value: value ?? SITE_SETTING_DEFAULTS[type], isDefault: value === undefined }];
      }),
    );
  },
  setSetting: (args, profile) => {
    const origin = originArg(args);
    if (!isType(args.type)) throw engineError("unknown type");
    if (typeof args.value !== "string" || !VALUES.has(args.value)) throw engineError("unknown value");
    rememberSiteSetting(profile, origin, args.type, args.value as SiteSettingValue | "default");
    return null;
  },
  origins: (_args, profile) => (database(profile).prepare("SELECT DISTINCT origin FROM site_settings ORDER BY origin").all() as { origin: string }[]).map((row) => row.origin),
  reset: (args, profile) => {
    const origin = originArg(args);
    database(profile).prepare("DELETE FROM site_settings WHERE origin = ?").run(origin);
    changed(profile, origin, null);
    return null;
  },
  clearData: async (args, profile) => {
    const origin = typeof args.origin === "string" ? siteOrigin(args.origin) : null;
    if (!origin) return { cookies: false, storage: false };
    return clearSiteData(profile, origin);
  },
  zoomLevels: (_args, profile) => {
    if (isPrivateProfile(profile)) return {};
    const rows = database(profile).prepare("SELECT host, zoom FROM zoom_levels").all() as { host: string; zoom: number }[];
    return Object.fromEntries(rows.map((row) => [row.host, Math.round(row.zoom * 100) / 100]));
  },
  setZoom: (args, profile) => {
    const host = typeof args.host === "string" ? args.host.toLowerCase() : "";
    const zoom = typeof args.zoom === "number" ? args.zoom : 0;
    if (!host || zoom <= 0) return null;
    const db = database(profile);
    transaction(db, () => {
      if (Math.abs(zoom - 1) < ZOOM_SAME) db.prepare("DELETE FROM zoom_levels WHERE host = ?").run(host);
      else db.prepare("INSERT INTO zoom_levels (host, zoom) VALUES (?, ?) ON CONFLICT(host) DO UPDATE SET zoom = excluded.zoom").run(host, zoom);
    });
    return null;
  },
});
