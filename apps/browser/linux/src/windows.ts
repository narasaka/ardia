import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { addReceiver } from "./bridge";
import { isBackground } from "./paths";

export const preloadPath = () => join(__dirname, "preload.js");

const pending = new Map<string, BrowserWindowConstructorOptions>();
const appWindows = new Map<string, BrowserWindow>();

export function shapeNextWindow(id: string, options: BrowserWindowConstructorOptions): void {
  pending.set(id, options);
}

export const appWindow = (id: string): BrowserWindow | undefined => appWindows.get(id);
export const appWindowIds = (): string[] => [...appWindows.keys()];

export function createHost(load: (window: BrowserWindow) => Promise<void>): BrowserWindow {
  const host = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: false, webviewTag: true, backgroundThrottling: false },
  });
  addReceiver(host.webContents);
  host.webContents.setWindowOpenHandler(({ frameName }) => {
    const shaped = pending.get(frameName) ?? {};
    pending.delete(frameName);
    return {
      action: "allow",
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        frame: false,
        show: !isBackground(),
        backgroundColor: "#00000000",
        transparent: true,
        ...shaped,
        webPreferences: { contextIsolation: true, sandbox: false, webviewTag: true, backgroundThrottling: false, ...shaped.webPreferences },
      },
    };
  });
  host.webContents.on("did-create-window", (child, { frameName }) => {
    appWindows.set(frameName, child);
    child.once("closed", () => appWindows.delete(frameName));
  });
  void load(host);
  return host;
}
