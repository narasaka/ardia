import { app, powerMonitor } from "electron";
import { existsSync, readFileSync, readdirSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { freemem, totalmem } from "node:os";
import { defineModule, emit } from "../bridge";
import { launchConfig } from "../launch";

const IDLE_POLL_MS = 5000;

let idleThresholds: number[] = [];
const idleNow = new Map<number, boolean>();
let idleTimer: ReturnType<typeof setInterval> | undefined;
let holdIncomingLinks = false;
let approvedFolders: string[] = [];
let asleep = false;

const signal = (payload: Record<string, unknown>) => emit("ArdiaSystemSignals", "onSystemSignal", payload);

function pollIdle(): void {
  const idleSeconds = powerMonitor.getSystemIdleTime();
  for (const threshold of idleThresholds) {
    const idle = idleSeconds >= threshold;
    if (idleNow.get(threshold) === idle) continue;
    idleNow.set(threshold, idle);
    signal({ type: "idle", threshold, idle });
  }
}

function watchIdle(thresholds: number[]): void {
  idleThresholds = (thresholds ?? []).filter((value) => Number.isFinite(value) && value > 0);
  idleNow.clear();
  for (const threshold of idleThresholds) idleNow.set(threshold, false);
  clearInterval(idleTimer);
  idleTimer = idleThresholds.length ? setInterval(pollIdle, IDLE_POLL_MS) : undefined;
}

function setAsleep(sleeping: boolean): void {
  if (asleep === sleeping) return;
  asleep = sleeping;
  signal({ type: sleeping ? "sleep" : "wake" });
}

function batteryReading(): { onBattery: boolean; batteryPercent: number | null } {
  let percent: number | null = null;
  try {
    for (const supply of readdirSync("/sys/class/power_supply")) {
      const folder = join("/sys/class/power_supply", supply);
      if (readFileSync(join(folder, "type"), "utf8").trim() !== "Battery") continue;
      percent = Number(readFileSync(join(folder, "capacity"), "utf8").trim());
      break;
    }
  } catch {}
  return { onBattery: powerMonitor.isOnBatteryPower(), batteryPercent: Number.isFinite(percent) ? percent : null };
}

function powerState() {
  const battery = batteryReading();
  return { ...battery, batterySaver: false, memoryLoad: Math.round(((totalmem() - freemem()) / totalmem()) * 100), physicalMemory: totalmem() };
}

function freeName(folder: string, name: string): string {
  const extension = extname(name);
  const stem = basename(name, extension);
  let candidate = join(folder, name);
  for (let n = 1; existsSync(candidate); n++) candidate = join(folder, `${stem} (${n})${extension}`);
  return candidate;
}

async function moveCompletedDownload(path: string, folder: string) {
  const target = resolve(folder);
  if (!approvedFolders.includes(target)) return { ok: false, reason: "folderNotApproved" };
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  if (!existsSync(target)) return { ok: false, reason: "folderMissing", stagedPath: path };
  const destination = freeName(target, basename(path));
  try {
    renameSync(path, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") return { ok: false, reason: "moveFailed", stagedPath: path };
    try {
      copyFileSync(path, destination);
      rmSync(path, { force: true });
    } catch {
      return { ok: false, reason: "moveFailed", stagedPath: path, strayPath: existsSync(destination) ? destination : undefined };
    }
  }
  return { ok: true, path: destination };
}

app.whenReady().then(() => {
  powerMonitor.on("suspend", () => setAsleep(true));
  powerMonitor.on("resume", () => setAsleep(false));
});

defineModule("ArdiaSystemSignals", {
  sync: {
    holdsIncomingLinks: () => holdIncomingLinks,
    powerState,
  },
  async: {
    watchIdle: async (thresholds: number[]) => watchIdle(thresholds),
    setHoldIncomingLinks: async (hold: boolean) => {
      holdIncomingLinks = !!hold;
    },
    setApprovedDownloadFolders: async (folders: string[]) => {
      approvedFolders = (folders ?? []).map((folder) => resolve(folder));
    },
    moveCompletedDownload,
    devPost: async (name: string) => {
      if (!launchConfig().isolated) return false;
      if (name === "willSleep") setAsleep(true);
      else if (name === "didWake") setAsleep(false);
      else return false;
      return true;
    },
  },
});
