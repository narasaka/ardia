import { app, nativeImage, shell } from "electron";
import { join } from "node:path";
import { defineModule } from "../bridge";
import { NATIVE_API_VERSION } from "../build";
import { launchConfig } from "../launch";
import { note } from "../log";
import { isBackground } from "../paths";
import { diagnosticsSample, hardwareInfo, systemInfo } from "../system/info";

const EXTERNAL_SCHEMES = /^(https?|mailto|tel|sms|facetime|zoommtg|slack|spotify|steam|tg|discord|msteams|vscode|x-[a-z0-9.+-]+):/i;

export function iconPath(): string {
  return join(__dirname, "icons", "512x512.png");
}

export async function openExternal(url: string): Promise<boolean> {
  if (typeof url !== "string" || !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(javascript|data|file|about|chrome|devtools):/i.test(url)) return false;
  if (isBackground()) {
    note("app", `background instance, not opening an external URL (${url.split(":")[0]})`);
    return true;
  }
  try {
    await shell.openExternal(url, { activate: true });
    return true;
  } catch (error) {
    note("app", `opening an external URL failed: ${String(error)}`);
    return false;
  }
}

async function appIcon(): Promise<string> {
  const image = nativeImage.createFromPath(iconPath());
  return image.isEmpty() ? "" : image.resize({ width: 256, height: 256 }).toDataURL();
}

async function shareURL(url: string, title: string | null): Promise<void> {
  const subject = encodeURIComponent(title ?? "");
  await openExternal(`mailto:?subject=${subject}&body=${encodeURIComponent(url)}`);
}

defineModule("ArdiaApp", {
  constants: { apiVersion: NATIVE_API_VERSION, linuxApiVersion: NATIVE_API_VERSION },
  sync: {
    systemInfo,
    launchConfig: () => launchConfig(),
    launchEnvironment: () => null,
  },
  async: {
    openExternalURL: (url: string) => openExternal(url),
    hardwareInfo,
    diagnosticsSample: async () => diagnosticsSample(),
    crashReports: async () => [],
    appIcons: async () => [],
    appIcon,
    setAppIcon: async () => {},
    isInDock: async () => false,
    addToDock: async () => false,
    setWindowActivity: async () => {},
    share: (url: string, title: string | null) => shareURL(url, title),
    shareVia: async (service: string, url: string, title: string | null) => {
      if (service === "mail" || service === "email") await shareURL(url, title);
    },
    shareText: async () => {},
    quitApp: async () => app.quit(),
  },
});
