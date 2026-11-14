import { app, shell } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineModule } from "../bridge";
import { launchConfig } from "../launch";
import { note } from "../log";
import { isBackground } from "../paths";
import { DESKTOP_FILE, MIME_TYPES, autostartFile, ensureUserDesktopEntry, writeAutostart, xdg } from "../system/desktopEntry";

function nativePath(path: string): string {
  if (typeof path !== "string") return "";
  if (path.startsWith("file:")) {
    try {
      return fileURLToPath(path);
    } catch {
      return "";
    }
  }
  return path;
}

async function defaultBrowserState() {
  const browser = await xdg("xdg-settings", "get", "default-web-browser");
  const http = await xdg("xdg-mime", "query", "default", "x-scheme-handler/http");
  const https = await xdg("xdg-mime", "query", "default", "x-scheme-handler/https");
  return { desktopFile: DESKTOP_FILE, browser, http, https, isDefault: browser === DESKTOP_FILE || (http === DESKTOP_FILE && https === DESKTOP_FILE) };
}

async function setAsDefaultBrowser(): Promise<boolean> {
  if (isBackground()) {
    note("system", "background instance, not setting the default browser");
    return false;
  }
  await ensureUserDesktopEntry();
  const set = await xdg("xdg-settings", "set", "default-web-browser", DESKTOP_FILE);
  if (set === null) for (const type of MIME_TYPES) await xdg("xdg-mime", "default", DESKTOP_FILE, type);
  return (await defaultBrowserState()).isDefault;
}

async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (isBackground()) return note("system", "background instance, not changing launch at login");
  if (launchConfig().isolated) return note("system", "custom data directory, not changing launch at login");
  if (enabled) await ensureUserDesktopEntry();
  writeAutostart(enabled);
}

async function fileIcon(path: string, size: number): Promise<string | null> {
  const target = nativePath(path);
  if (!target) return null;
  try {
    const icon = await app.getFileIcon(target, { size: size <= 16 ? "small" : size <= 32 ? "normal" : "large" });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

defineModule("ArdiaSystem", {
  constants: { backgroundInstance: isBackground() },
  sync: {
    fileExists: (path: string) => {
      const target = nativePath(path);
      return !!target && existsSync(target);
    },
    hapticTick: () => {},
  },
  async: {
    isDefaultBrowser: async () => (await defaultBrowserState()).isDefault,
    setAsDefaultBrowser,
    defaultBrowserState,
    launchAtLoginStatus: async () => (existsSync(autostartFile()) ? "enabled" : "notRegistered"),
    setLaunchAtLogin,
    openFile: async (path: string) => {
      const target = nativePath(path);
      if (!target || !existsSync(target)) return false;
      if (isBackground()) return true;
      return (await shell.openPath(target)) === "";
    },
    revealFile: async (path: string) => {
      const target = nativePath(path);
      if (!target || !existsSync(target)) return false;
      if (!isBackground()) shell.showItemInFolder(target);
      return true;
    },
    moveToTrash: async (path: string) => {
      const target = nativePath(path);
      if (!target || !existsSync(target)) return false;
      try {
        await shell.trashItem(target);
        return true;
      } catch {
        return false;
      }
    },
    fileIcon,
    runningAppIcon: async () => null,
    setThinScrollBars: async () => {},
  },
});
