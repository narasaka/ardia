import { session, type Session } from "electron";
import { join } from "node:path";
import { dataDirectory } from "../paths";

const PRIVATE_PREFIX = "incognito";
const OFF_THE_RECORD = "@";
const ARDIA_ID = /^[a-z0-9-]{1,238}$/;
const DEFAULT_FOLDER = "Default";

export const isPrivateProfile = (profile: string) => profile.startsWith(PRIVATE_PREFIX) || profile.includes(OFF_THE_RECORD);

export function originalProfile(profile: string): string {
  if (!isPrivateProfile(profile)) return profile;
  const at = profile.indexOf("@");
  return at < 0 ? "" : profile.slice(at + 1);
}

export const profilesDirectory = () => join(dataDirectory(), "Profiles");

export function profileFolderName(profile: string): string | null {
  if (!profile) return DEFAULT_FOLDER;
  return ARDIA_ID.test(profile) ? profile : null;
}

export function profileDirectory(profile: string): string {
  const name = profileFolderName(profile);
  if (!name) throw Object.assign(new Error(`"${profile}" isn't a profile id Ardia makes`), { code: "ERR_ENGINE" });
  return join(profilesDirectory(), name);
}

const PERSISTENT_PARTITION = "persist:ardia";
const PRIVATE_PARTITION = "ardia-private";

export function partitionFor(profile: string): string {
  if (isPrivateProfile(profile)) return `${PRIVATE_PARTITION}-${encodeURIComponent(profile)}`;
  return profile ? `${PERSISTENT_PARTITION}-${encodeURIComponent(profile)}` : PERSISTENT_PARTITION;
}

export const sessionFor = (profile: string): Session => session.fromPartition(partitionFor(profile));

export function profileOfPartition(partition: string): string | null {
  if (partition === PERSISTENT_PARTITION) return "";
  if (partition.startsWith(`${PERSISTENT_PARTITION}-`)) return decodeURIComponent(partition.slice(PERSISTENT_PARTITION.length + 1));
  if (partition.startsWith(`${PRIVATE_PARTITION}-`)) return decodeURIComponent(partition.slice(PRIVATE_PARTITION.length + 1));
  return null;
}

export function engineError(message: string): Error {
  return Object.assign(new Error(message), { code: "ERR_ENGINE" });
}
