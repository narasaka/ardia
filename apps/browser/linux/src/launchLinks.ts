import { app } from "electron";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emit } from "./bridge";
import { note } from "./log";
import { focusAppWindow } from "./windowFocus";
import { appWindowIds } from "./windows";

const SCHEME = /^([a-z][a-z0-9+.-]+):(.*)$/is;
const WEB_REST = /^\/*([^\s/\\?#]+)(.*)$/s;
const BARE_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*)(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i;
const ELECTRON_SWITCH = /^--?[a-z]/i;
const RELEASE_AFTER_FIRST_WINDOW_MS = 250;

const escapedSpaces = (text: string) => text.replace(/\s/g, (space) => encodeURIComponent(space));

export function addressOf(argument: string, cwd: string): string | null {
  const text = argument.trim();
  if (!text) return null;
  const scheme = SCHEME.exec(text);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name === "http" || name === "https") {
      const web = WEB_REST.exec(scheme[2]!);
      return web ? `${name}://${web[1]}${escapedSpaces(web[2]!)}` : null;
    }
    if (name === "file") return escapedSpaces(text);
    return null;
  }
  const path = isAbsolute(text) ? text : resolve(cwd, text);
  if ((isAbsolute(text) || text.startsWith(".") || text.includes("/")) && existsSync(path)) return pathToFileURL(path).href;
  if (existsSync(path) && !BARE_HOST.test(text)) return pathToFileURL(path).href;
  return BARE_HOST.test(text) ? `http://${text}` : null;
}

export function launchAddresses(argv: string[], cwd: string): string[] {
  const addresses: string[] = [];
  let switchesEnded = false;
  for (const argument of argv) {
    if (!switchesEnded && argument === "--") {
      switchesEnded = true;
      continue;
    }
    if (!switchesEnded && ELECTRON_SWITCH.test(argument)) continue;
    const address = addressOf(argument, cwd);
    if (address) addresses.push(address);
  }
  return addresses;
}

function userArguments(argv: string[], cwd: string): string[] {
  const appPath = app.getAppPath();
  return argv.slice(1).filter((argument) => app.isPackaged || resolve(cwd, argument) !== appPath);
}

let held: string[] | null = null;
let openedAtLaunch = 0;
let windowsOpened = false;

function deliver(urls: string[]): void {
  emit("ArdiaShell", "onOpenURLs", { urls });
}

function releaseHeld(): void {
  if (!held) return;
  const urls = held;
  held = null;
  openedAtLaunch += urls.length;
  note("launch", `launch links: ${urls.length} sent to the app`);
  deliver(urls);
}

export function takeOpenedAtLaunch(): number {
  const taken = openedAtLaunch;
  openedAtLaunch = 0;
  return taken;
}

export function installLaunchLinks(): void {
  const urls = launchAddresses(userArguments(process.argv, process.cwd()), process.cwd());
  if (urls.length) {
    held = urls;
    note("launch", `launch links: ${urls.length} held until the first window opens`);
  }
  app.on("browser-window-created", () =>
    setTimeout(() => {
      if (windowsOpened || !appWindowIds().length) return;
      windowsOpened = true;
      releaseHeld();
    }, RELEASE_AFTER_FIRST_WINDOW_MS),
  );
  app.on("second-instance", (_event, argv, cwd) => {
    const opened = launchAddresses(userArguments(argv, cwd), cwd);
    note("launch", `a second launch asked for ${opened.length} link(s)`);
    if (opened.length) deliver(opened);
    else if (argv.includes("--new-window")) emit("ArdiaMenus", "onCommand", { command: "newWindow", arg: null, windowId: null, focusGeneration: null });
    else emit("ArdiaShell", "onAppEvent", { type: "reopen", pastFloating: false });
    const [first] = appWindowIds();
    if (first) focusAppWindow(first);
  });
}
