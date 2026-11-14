import { contextBridge, ipcRenderer } from "electron";
import pageScript from "../../../../../packages/ardiacore/ios/page_script.js";

type Receive = (kind: string, json: string) => void;

const post = (kind: string, json: string) => ipcRenderer.send("ardia:page-script", kind, json);

let receive: Receive | undefined;
try {
  receive = contextBridge.executeInMainWorld({ func: pageScript as (post: (kind: string, json: string) => void) => Receive, args: [post] }) as Receive | undefined;
} catch (error) {
  ipcRenderer.send("ardia:page-script", "scriptFailed", JSON.stringify({ message: String((error as Error)?.message ?? error) }));
}

ipcRenderer.on("ardia:page-script", (_event, kind: string, json: string) => {
  if (typeof receive === "function") receive(kind, json);
});
