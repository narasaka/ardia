import { app, session as sessions, type Session, type WebContents } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "../paths";
import { profileOfPartition } from "./profiles";

type PageScript = { id: string; source: string };

const profileOfSession = new WeakMap<Session, string>();
const prepared = new WeakSet<Session>();
const pageScripts: PageScript[] = [];
const sessionListeners = new Set<(session: Session, profile: string) => void>();

function scriptFile(script: PageScript): string {
  const folder = join(dataDirectory(), "Engine", "PageScripts");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${script.id}.js`);
  writeFileSync(path, script.source);
  return path;
}

function prepare(session: Session, profile: string) {
  profileOfSession.set(session, profile);
  if (prepared.has(session)) return;
  prepared.add(session);
  for (const script of pageScripts) session.registerPreloadScript({ id: script.id, type: "frame", filePath: scriptFile(script), matches: ["http://*/*", "https://*/*"] });
  for (const listener of sessionListeners) listener(session, profile);
}

export function definePageScript(id: string, page: (ipc: Electron.IpcRenderer) => void): void {
  pageScripts.push({ id, source: `(${page.toString()})(require("electron").ipcRenderer);\n` });
}

export function onProfileSession(listener: (session: Session, profile: string) => void): () => void {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

export const profileOfContents = (contents: WebContents): string | null => profileOfSession.get(contents.session) ?? null;

export function watchPartition(partition: string): string | null {
  const profile = profileOfPartition(partition);
  if (profile === null) return null;
  prepare(sessions.fromPartition(partition), profile);
  return profile;
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (_attach, _preferences, params) => {
    if (typeof params.partition === "string") watchPartition(params.partition);
  });
});
