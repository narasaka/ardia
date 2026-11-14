import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import extensionsPreload from "electron-chrome-extensions/preload" with { type: "text" };
import webStorePreload from "electron-chrome-web-store/preload" with { type: "text" };
import { dataDirectory } from "../paths";

function modulePath(name: string, file: string, source: string): string {
  const root = join(dataDirectory(), "Engine", "PageScripts", "vendor", name);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", file), source);
  return root;
}

let extensionsRoot: string | null = null;
let webStoreRoot: string | null = null;

export const extensionsModulePath = () => (extensionsRoot ??= modulePath("electron-chrome-extensions", "chrome-extension-api.preload.js", extensionsPreload));
export const webStoreModulePath = () => (webStoreRoot ??= modulePath("electron-chrome-web-store", "chrome-web-store.preload.js", webStorePreload));
