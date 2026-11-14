import { app } from "electron";
import { guestOf, tell, tellNavigation, type Guest, type ThemeSource } from "./guests";

const CHANNEL = "ardia:page-script";

export type PageScriptConfig = {
  peek: "alt" | "shift" | "off";
  split: "alt" | "altShift";
  peekOtherSites: string[];
  selectionPopover: boolean;
  displayMediaPicker: boolean;
  blockAutoplay: boolean;
};

const config: PageScriptConfig = { peek: "off", split: "alt", peekOtherSites: [], selectionPopover: false, displayMediaPicker: false, blockAutoplay: false };
const loggedFailures = new Set<string>();

export function sendToPageScript(guest: Guest, kind: string, data: unknown) {
  if (!guest.contents.isDestroyed()) guest.contents.send(CHANNEL, kind, JSON.stringify(data));
}

const configFor = (guest: Guest) => ({ ...config, peekOtherSites: config.peekOtherSites.includes(guest.tabId) });

export function configurePageScripts(change: Partial<PageScriptConfig>, guests: Iterable<Guest>) {
  Object.assign(config, change);
  for (const guest of guests) sendToPageScript(guest, "config", configFor(guest));
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

type Message = Record<string, unknown> | null;

const handlers: Record<string, (guest: Guest, message: Message, top: boolean) => void> = {
  hello: (guest, _message, _top) => sendToPageScript(guest, "config", configFor(guest)),
  displayMediaHello: (guest) => sendToPageScript(guest, "config", configFor(guest)),
  theme: (guest, message, top) => {
    if (!top || !message) return;
    const color = typeof message.color === "string" ? message.color : null;
    const source = (typeof message.source === "string" ? message.source : null) as ThemeSource;
    guest.scriptTheme = { color, source };
    tellNavigation(guest);
  },
  scroll: (guest, message, top) => top && message && tell(guest, "scroll", { state: message.state }),
  selection: (guest, message, top) => top && tell(guest, "selection", { selection: message }),
  nowPlaying: (guest, message, top) => top && tell(guest, "nowPlaying", { state: message }),
  appBadge: (guest, message, top) => {
    if (!top) return;
    const count = typeof message?.count === "number" ? message.count : null;
    tell(guest, "appBadge", { origin: originOf(guest.url), count, flag: count === null && message?.flag === true });
  },
  notification: (guest, message, top) => {
    if (!message) return;
    tell(guest, "notification", { ...message, origin: originOf(guest.url), tabId: guest.tabId || null, isMainFrame: top });
  },
  notificationClose: (guest, message) => message && tell(guest, "notificationClose", { id: message.id }),
  scriptFailed: (_guest, message) => {
    const reason = String(message?.message ?? "");
    if (loggedFailures.has(reason)) return;
    loggedFailures.add(reason);
    console.warn(`[ardia linux] the page script did not start: ${reason}`);
  },
};

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.on("ipc-message", (event, channel, kind: unknown, json: unknown) => {
    if (channel !== CHANNEL || typeof kind !== "string") return;
    const guest = guestOf(contents);
    const handler = handlers[kind];
    if (!guest || !handler) return;
    let message: Message = null;
    try {
      message = typeof json === "string" ? (JSON.parse(json) as Message) : null;
    } catch {
      return;
    }
    handler(guest, message, event.senderFrame === contents.mainFrame);
  });
});
