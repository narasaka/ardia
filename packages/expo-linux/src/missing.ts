const seen = new Set<string>();

export function noteMissing(what: string) {
  if (seen.has(what)) return;
  seen.add(what);
  console.info(`[ardia linux] no Linux version yet: ${what}`);
}

export const missingOnLinux = () => [...seen].sort();

Object.assign(globalThis, { ardiaLinuxMissing: missingOnLinux });
