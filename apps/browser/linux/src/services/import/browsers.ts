import type { Family } from "./model";

export type Browser = {
  id: string;
  name: string;
  family: Family;
  path: string;
  rootIsProfile?: boolean;
  sidebar?: "arc" | "zen";
  keyring?: string;
};

const chromium = (id: string, name: string, path: string, keyring: string, rootIsProfile = false): Browser => ({ id, name, family: "chromium", path, keyring, rootIsProfile });
const flatpak = (app: string, path: string) => `.var/app/${app}/${path}`;

export const BROWSERS: Browser[] = [
  chromium("chrome", "Google Chrome", ".config/google-chrome", "chrome"),
  chromium("chromeFlatpak", "Google Chrome (Flatpak)", flatpak("com.google.Chrome", "config/google-chrome"), "chrome"),
  { id: "firefox", name: "Firefox", family: "firefox", path: ".mozilla/firefox" },
  { id: "firefoxXdg", name: "Firefox", family: "firefox", path: ".config/mozilla/firefox" },
  { id: "firefoxSnap", name: "Firefox (Snap)", family: "firefox", path: "snap/firefox/common/.mozilla/firefox" },
  { id: "firefoxFlatpak", name: "Firefox (Flatpak)", family: "firefox", path: flatpak("org.mozilla.firefox", ".mozilla/firefox") },
  { id: "zen", name: "Zen", family: "firefox", path: ".zen", sidebar: "zen" },
  { id: "zenFlatpak", name: "Zen (Flatpak)", family: "firefox", path: flatpak("app.zen_browser.zen", ".zen"), sidebar: "zen" },
  chromium("chromium", "Chromium", ".config/chromium", "chromium"),
  chromium("chromiumSnap", "Chromium (Snap)", "snap/chromium/common/chromium", "chromium"),
  chromium("chromiumFlatpak", "Chromium (Flatpak)", flatpak("org.chromium.Chromium", "config/chromium"), "chromium"),
  chromium("brave", "Brave", ".config/BraveSoftware/Brave-Browser", "brave"),
  chromium("braveSnap", "Brave (Snap)", "snap/brave/current/.config/BraveSoftware/Brave-Browser", "brave"),
  chromium("braveFlatpak", "Brave (Flatpak)", flatpak("com.brave.Browser", "config/BraveSoftware/Brave-Browser"), "brave"),
  chromium("edge", "Microsoft Edge", ".config/microsoft-edge", "Microsoft Edge"),
  chromium("edgeFlatpak", "Microsoft Edge (Flatpak)", flatpak("com.microsoft.Edge", "config/microsoft-edge"), "Microsoft Edge"),
  chromium("vivaldi", "Vivaldi", ".config/vivaldi", "vivaldi"),
  chromium("vivaldiFlatpak", "Vivaldi (Flatpak)", flatpak("com.vivaldi.Vivaldi", "config/vivaldi"), "vivaldi"),
  chromium("opera", "Opera", ".config/opera", "opera", true),
  chromium("operaSnap", "Opera (Snap)", "snap/opera/current/.config/opera", "opera", true),
  chromium("chromeBeta", "Google Chrome Beta", ".config/google-chrome-beta", "chrome"),
  chromium("chromeDev", "Google Chrome Dev", ".config/google-chrome-unstable", "chrome"),
  chromium("edgeBeta", "Microsoft Edge Beta", ".config/microsoft-edge-beta", "Microsoft Edge"),
  chromium("edgeDev", "Microsoft Edge Dev", ".config/microsoft-edge-dev", "Microsoft Edge"),
  chromium("braveBeta", "Brave Beta", ".config/BraveSoftware/Brave-Browser-Beta", "brave"),
  chromium("braveNightly", "Brave Nightly", ".config/BraveSoftware/Brave-Browser-Nightly", "brave"),
  chromium("vivaldiSnapshot", "Vivaldi Snapshot", ".config/vivaldi-snapshot", "vivaldi"),
];

export const findBrowser = (id: string) => BROWSERS.find((b) => b.id === id);

export const isChromiumBased = (b: Browser) => b.family === "chromium" || b.family === "arc";
