import { app, type BrowserWindow } from "electron";
import { join } from "node:path";
import { installBridge } from "./bridge";
import "./modules";
import { dataDirectory } from "./paths";
import { createHost } from "./windows";

app.setName("Ardia");
app.setPath("userData", join(dataDirectory(), "Engine"));
if (process.env.ARDIA_REMOTE_DEBUGGING_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.ARDIA_REMOTE_DEBUGGING_PORT);

const devServer = process.env.ARDIA_DEV_SERVER;

async function loadUi(host: BrowserWindow) {
  if (devServer) await host.loadURL(devServer);
  else await host.loadFile(join(__dirname, "../ui/index.html"));
}

if (!app.requestSingleInstanceLock({ dataDirectory: dataDirectory() })) app.quit();
else
  app.whenReady().then(() => {
    installBridge();
    createHost(loadUi);
  });

app.on("window-all-closed", () => app.quit());
