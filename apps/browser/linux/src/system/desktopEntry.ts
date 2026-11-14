import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const DESKTOP_FILE = "ardia.desktop";
export const WINDOW_CLASS = "Ardia";
export const MIME_TYPES = ["text/html", "text/xml", "application/xhtml+xml", "x-scheme-handler/http", "x-scheme-handler/https"];

const run = promisify(execFile);

const dataHome = () => process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

export const userDesktopFile = () => join(dataHome(), "applications", DESKTOP_FILE);
export const autostartFile = () => join(configHome(), "autostart", DESKTOP_FILE);

export function launcherPath(): string {
  return process.env.APPIMAGE || process.env.ARDIA_LAUNCHER || process.execPath;
}

const quoted = (path: string) => (/[\s"'\\$`]/.test(path) ? `"${path.replace(/(["\\$`])/g, "\\$1")}"` : path);

export function desktopEntry(extra: Record<string, string> = {}): string {
  const exec = quoted(launcherPath());
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Ardia",
    "GenericName=Web Browser",
    "Comment=Browse the web",
    `Exec=${exec} %U`,
    "Icon=ardia",
    "Terminal=false",
    "Categories=Network;WebBrowser;",
    `MimeType=${MIME_TYPES.join(";")};`,
    `StartupWMClass=${WINDOW_CLASS}`,
    "StartupNotify=true",
    "Actions=new-window;",
    ...Object.entries(extra).map(([key, value]) => `${key}=${value}`),
    "",
    "[Desktop Action new-window]",
    "Name=New Window",
    `Exec=${exec} --new-window`,
    "",
  ];
  return lines.join("\n");
}

export const installedSystemWide = () => ["/usr/share/applications", "/usr/local/share/applications"].some((folder) => existsSync(join(folder, DESKTOP_FILE)));

function installIcons(): void {
  const icons = join(__dirname, "icons");
  if (!existsSync(icons)) return;
  for (const file of readdirSync(icons)) {
    const size = file.replace(/\.png$/, "");
    const folder = join(dataHome(), "icons/hicolor", size, "apps");
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(icons, file), join(folder, "ardia.png"));
  }
}

export async function ensureUserDesktopEntry(): Promise<void> {
  if (installedSystemWide() && !process.env.APPIMAGE) return;
  mkdirSync(join(dataHome(), "applications"), { recursive: true });
  writeFileSync(userDesktopFile(), desktopEntry());
  installIcons();
  await run("update-desktop-database", [join(dataHome(), "applications")]).catch(() => {});
}

export async function xdg(command: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(command, args, { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function writeAutostart(enabled: boolean): void {
  if (!enabled) return void rmSync(autostartFile(), { force: true });
  mkdirSync(join(configHome(), "autostart"), { recursive: true });
  writeFileSync(autostartFile(), desktopEntry({ "X-GNOME-Autostart-enabled": "true", "X-Ardia-Autostart": "true" }).replace(" %U", " --autostart"));
}

