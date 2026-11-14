import { app, screen } from "electron";
import { readFileSync, statfsSync } from "node:fs";
import { arch, cpus, release, totalmem } from "node:os";
import { APP_BUILD, APP_VERSION, BUNDLE_ID, DEBUG_BUILD, RELEASE_NOTES_PAGE } from "../build";
import { instanceFlag, launchConfig } from "../launch";
import { dataDirectory } from "../paths";

const processStart = Date.now() - Math.round(process.uptime() * 1000);

function osRelease(): Record<string, string> {
  try {
    const fields: Record<string, string> = {};
    for (const line of readFileSync("/etc/os-release", "utf8").split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      if (match) fields[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1");
    }
    return fields;
  } catch {
    return {};
  }
}

const distro = osRelease();

function bootTime(): number | null {
  try {
    const line = readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((row) => row.startsWith("btime "));
    return line ? Number(line.slice(6)) * 1000 : null;
  } catch {
    return null;
  }
}

function loadAverage(): number | null {
  try {
    return Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  } catch {
    return null;
  }
}

const archName = () => (arch() === "x64" ? "x64" : arch() === "arm64" ? "arm64" : arch());

export function systemInfo() {
  const config = launchConfig();
  return {
    appName: "Ardia",
    appVersion: APP_VERSION,
    appBuild: APP_BUILD,
    bundleId: BUNDLE_ID,
    configuration: DEBUG_BUILD ? "Debug" : "Release",
    osVersion: distro.VERSION_ID || release().split("-")[0] || "0",
    osBuild: release(),
    osName: distro.PRETTY_NAME || distro.NAME || "Linux",
    arch: archName(),
    model: "PC",
    memoryGB: totalmem() / 1073741824,
    locale: app.isReady() ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale,
    feedbackURL: config.feedbackURL,
    releaseNotesURL: RELEASE_NOTES_PAGE,
    isolatedInstance: config.isolated,
    forceReleaseNotes: instanceFlag("releaseNotes"),
    processStart,
    bootTime: bootTime(),
    launchedHidden: config.background,
    loadAverage1m: loadAverage(),
    inApplicationsFolder: app.isPackaged,
  };
}

async function gpuName(): Promise<string | undefined> {
  try {
    const info = (await app.getGPUInfo("basic")) as { gpuDevice?: { active?: boolean; vendorString?: string; deviceString?: string; driverVendor?: string }[] };
    const device = info.gpuDevice?.find((gpu) => gpu.active) ?? info.gpuDevice?.[0];
    const name = [device?.vendorString, device?.deviceString].filter(Boolean).join(" ");
    return name || device?.driverVendor || undefined;
  } catch {
    return undefined;
  }
}

async function decodes(): Promise<{ av1: boolean; vp9: boolean; hevc: boolean; h264: boolean }> {
  const found = { av1: false, vp9: false, hevc: false, h264: false };
  try {
    const info = (await app.getGPUInfo("complete")) as { videoDecodeAcceleratorSupportedProfiles?: { codec?: string; profile?: string }[]; auxAttributes?: Record<string, unknown> };
    for (const entry of info.videoDecodeAcceleratorSupportedProfiles ?? []) {
      const codec = `${entry.codec ?? ""} ${entry.profile ?? ""}`.toLowerCase();
      if (codec.includes("av1")) found.av1 = true;
      if (codec.includes("vp9")) found.vp9 = true;
      if (codec.includes("hevc") || codec.includes("h265")) found.hevc = true;
      if (codec.includes("h264") || codec.includes("avc")) found.h264 = true;
    }
  } catch {}
  return found;
}

export async function hardwareInfo() {
  const displays = app.isReady() ? screen.getAllDisplays() : [];
  return {
    chip: cpus()[0]?.model?.trim() || archName(),
    gpu: await gpuName(),
    memoryGB: Math.round(totalmem() / 1073741824),
    displays: displays.length,
    maxScale: displays.reduce((most, display) => Math.max(most, display.scaleFactor), 1),
    hardwareDecode: await decodes(),
  };
}

export function diagnosticsSample() {
  const sample: { footprintMB?: number; freeDiskGB?: number } = {};
  try {
    const kilobytes = app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0);
    sample.footprintMB = Math.round(kilobytes / 1024);
  } catch {}
  try {
    const disk = statfsSync(dataDirectory());
    sample.freeDiskGB = Math.round((disk.bavail * disk.bsize) / 107374182.4) / 10;
  } catch {}
  return sample;
}
