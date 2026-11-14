import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SIZES = ["128x128", "256x256", "96x96", "64x64", "48x48", "512x512", "scalable"];
const SNAP_DESKTOP_FILES = "/var/lib/snapd/desktop/applications";

const themeRoots = (home: string) => [
  join(home, ".local/share/icons/hicolor"),
  join(home, ".local/share/flatpak/exports/share/icons/hicolor"),
  "/var/lib/flatpak/exports/share/icons/hicolor",
  "/usr/local/share/icons/hicolor",
  "/usr/share/icons/hicolor",
];

function snapIcon(names: string[]): string | null {
  let files: string[];
  try {
    files = readdirSync(SNAP_DESKTOP_FILES);
  } catch {
    return null;
  }
  for (const name of names) {
    const file = files.find((entry) => entry.startsWith(`${name}_`) && entry.endsWith(".desktop"));
    if (!file) continue;
    try {
      const icon = /^Icon=(.+)$/m.exec(readFileSync(join(SNAP_DESKTOP_FILES, file), "utf8"))?.[1]?.trim();
      if (icon?.startsWith("/") && existsSync(icon)) return icon;
    } catch {}
  }
  return null;
}

export function browserIcon(home: string, names: string[]): string | null {
  for (const name of names) {
    for (const root of themeRoots(home)) {
      for (const size of SIZES) {
        for (const extension of size === "scalable" ? ["svg"] : ["png"]) {
          const path = join(root, size, "apps", `${name}.${extension}`);
          if (existsSync(path)) return path;
        }
      }
    }
    for (const extension of ["png", "svg"]) {
      const path = `/usr/share/pixmaps/${name}.${extension}`;
      if (existsSync(path)) return path;
    }
  }
  return snapIcon(names);
}
