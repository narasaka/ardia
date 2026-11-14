import type { Session, WebContents } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guestOf } from "../engine/guests";
import { onPageSession, profileOfSession } from "../engine/sessions";
import { dataDirectory } from "../paths";

type PageScript = { id: string; source: string };

const pageScripts: PageScript[] = [];
const prepared = new WeakSet<Session>();

function scriptFile(script: PageScript): string {
  const folder = join(dataDirectory(), "Engine", "PageScripts");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${script.id}.js`);
  writeFileSync(path, script.source);
  return path;
}

export function definePageScript(id: string, page: (ipc: Electron.IpcRenderer) => void): void {
  pageScripts.push({ id, source: `(${page.toString()})(require("electron").ipcRenderer);\n` });
}

export function onProfileSession(listener: (session: Session, profile: string) => void): void {
  onPageSession(listener);
}

export const profileOfContents = (contents: WebContents): string | null => guestOf(contents)?.profile ?? (prepared.has(contents.session) ? profileOfSession(contents.session) : null);

onPageSession((session) => {
  if (prepared.has(session)) return;
  prepared.add(session);
  for (const script of pageScripts) session.registerPreloadScript({ id: script.id, type: "frame", filePath: scriptFile(script), matches: ["http://*/*", "https://*/*"] });
});
