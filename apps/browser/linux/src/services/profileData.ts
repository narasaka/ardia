import { rm } from "node:fs/promises";
import { defineDomain } from "../engine/domains";
import { closeDatabase, database, openProfiles } from "./database";
import { deleteHistorySince } from "./history";
import { engineError, isPrivateProfile, profileDirectory, profileFolderName, sessionFor } from "./profiles";
import { clearSiteSettings } from "./sites";

const KINDS = new Set(["history", "siteData", "cache", "downloads", "formData", "siteSettings"]);
const SITE_DATA: Electron.ClearDataOptions["dataTypes"] = ["backgroundFetch", "cookies", "fileSystems", "indexedDB", "localStorage", "serviceWorkers", "webSQL"];
const OFF_THE_RECORD = "@";

type DownloadsClearer = (profile: string, since: number) => void | Promise<void>;
const downloadsClearers = new Set<DownloadsClearer>();

export function onClearDownloads(clear: DownloadsClearer): () => void {
  downloadsClearers.add(clear);
  return () => void downloadsClearers.delete(clear);
}

export async function clearBrowsingData(profile: string, types: string[], since: number) {
  for (const type of types) if (!KINDS.has(type)) throw engineError("unknown type");
  if (!types.length) throw engineError("types required");
  const session = sessionFor(profile);
  const work: Promise<unknown>[] = [];
  if (types.includes("history") && !isPrivateProfile(profile)) deleteHistorySince(profile, since);
  if (types.includes("siteData")) work.push(session.clearData({ dataTypes: SITE_DATA }));
  if (types.includes("cache")) work.push(session.clearCache(), session.clearCodeCaches({}));
  if (types.includes("downloads")) for (const clear of downloadsClearers) work.push(Promise.resolve(clear(profile, since)));
  if (types.includes("formData")) {
    const db = database(profile);
    db.prepare("DELETE FROM addresses WHERE modified >= ?").run(since);
    db.prepare("DELETE FROM cards WHERE modified >= ?").run(since);
  }
  if (types.includes("siteSettings")) clearSiteSettings(profile);
  const results = await Promise.allSettled(work);
  return { ok: results.every((result) => result.status === "fulfilled") };
}

async function deleteData(profile: string): Promise<string[]> {
  if (profile.includes("\u0000") || (profile && !profileFolderName(profile) && !isPrivateProfile(profile))) return ["data (the profile's id isn't one Ardia makes)"];
  if (profile.includes(OFF_THE_RECORD)) return [];
  const remaining: string[] = [];
  const session = sessionFor(profile);
  closeDatabase(profile);
  try {
    await session.clearData();
    await session.clearCache();
  } catch {
    remaining.push("site data");
  }
  try {
    await rm(profileDirectory(profile), { recursive: true, force: true });
  } catch (error) {
    remaining.push(`files (${(error as NodeJS.ErrnoException).code ?? "unreadable"})`);
  }
  if (session.storagePath) {
    try {
      await rm(session.storagePath, { recursive: true, force: true });
    } catch {
      remaining.push("files in use until Ardia restarts");
    }
  }
  return remaining;
}

defineDomain("profiles", {
  loaded: () => ({ profiles: openProfiles() }),
  release: async (_args, profile) => {
    if (!isPrivateProfile(profile)) return null;
    closeDatabase(profile);
    await sessionFor(profile).clearData().catch(() => {});
    return null;
  },
  deleteData: async (_args, profile) => ({ remaining: await deleteData(profile) }),
  clearBrowsingData: async (args, profile) => {
    const types = Array.isArray(args.types) ? args.types.filter((type): type is string => typeof type === "string") : [];
    if (!types.length) return null;
    const since = typeof args.since === "number" && Number.isFinite(args.since) && args.since > 0 ? args.since : 0;
    await clearBrowsingData(profile, types, since);
    return null;
  },
});
