import { app, nativeImage, type BrowserWindow } from "electron";
import { join } from "node:path";
import { installBridge } from "./bridge";
import "./engine";
import "./menus/keyboard";
import "./modules";
import "./services";
import { iconPath } from "./modules/ardiaApp";
import { installLaunchLinks } from "./launchLinks";
import { launchConfig } from "./launch";
import { note } from "./log";
import { dataDirectory } from "./paths";
import { installQuitLifecycle } from "./quit";
import { DESKTOP_FILE } from "./system/desktopEntry";
import { createHost } from "./windows";

app.setName("Ardia");
app.setDesktopName(DESKTOP_FILE);
app.setPath("userData", join(dataDirectory(), "Engine"));
if (process.env.ARDIA_REMOTE_DEBUGGING_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.ARDIA_REMOTE_DEBUGGING_PORT);

const sandboxed = !app.commandLine.hasSwitch("no-sandbox");
note("launch", `${sandboxed ? "sandboxed with" : "no sandbox:"} ${process.env.ARDIA_SANDBOX_REASON ?? (sandboxed ? "Chromium's default" : "--no-sandbox was passed")}`);

const devServer = process.env.ARDIA_DEV_SERVER;

async function loadUi(host: BrowserWindow) {
  if (devServer) await host.loadURL(devServer);
  else await host.loadFile(join(__dirname, "../ui/index.html"));
}

if (!app.requestSingleInstanceLock({ dataDirectory: dataDirectory() })) {
  note("launch", "Ardia is already running with this data folder; the links went to it");
  app.exit(0);
} else {
  launchConfig();
  installQuitLifecycle();
  installLaunchLinks();
  app.on("browser-window-created", (_event, window) => {
    const icon = nativeImage.createFromPath(iconPath());
    if (!icon.isEmpty()) window.setIcon(icon);
  });
  app.whenReady().then(() => {
    installBridge();
    createHost(loadUi);
  });
}
