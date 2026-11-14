const OFF_THE_RECORD = "@";
const PERSISTENT = "persist:ardia";
const PRIVATE = "ardia-private";

export const isPrivateProfile = (profile: string) => profile.includes(OFF_THE_RECORD);

export function partitionOf(profile: string): string {
  if (isPrivateProfile(profile)) return `${PRIVATE}-${encodeURIComponent(profile)}`;
  return profile ? `${PERSISTENT}-${encodeURIComponent(profile)}` : PERSISTENT;
}

export function profileOfPartition(partition: string): string | null {
  if (partition === PERSISTENT) return "";
  if (partition.startsWith(`${PERSISTENT}-`)) return decodeURIComponent(partition.slice(PERSISTENT.length + 1));
  if (partition.startsWith(`${PRIVATE}-`)) return decodeURIComponent(partition.slice(PRIVATE.length + 1));
  return null;
}
