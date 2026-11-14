import { AppRegistry } from "react-native";
import { appDark, onAppDarkChange } from "../appearance";
import { callMain, callMainSync } from "../bridge";
import { addNativeListener } from "../events";
import { adoptAppWindow, forgetAppWindow } from "../host/acrossWindows";
import { mirrorStylesInto, stopMirroring } from "../host/documentStyles";

type Realm = Window & typeof globalThis;
type OpenOptions = { kind?: string; title?: string; focus?: boolean; animated?: boolean; incognito?: boolean } & Record<string, unknown>;
type Mounted = { realm: Realm; root: { unmount(): void } | null; shown: boolean };

const MODULE = "ArdiaAppWindows";
const ENTRANCE_MS = { browser: 250, small: 200 } as const;
const EXIT_MS = { browser: 180, small: 150 } as const;
const SHOW_FALLBACK_MS = 400;
const APP_KEY = "main";
const REGISTER_TRIES = 100;

const mounted = new Map<string, Mounted>();
const kinds = new Map<string, string>();
const squared = new Map<string, { maximized: boolean; fullScreen: boolean }>();

type WindowEvent = { type?: string; id?: string; on?: boolean };

function applyShape(id: string) {
  const doc = appWindowDocument(id);
  if (!doc) return;
  const state = squared.get(id);
  doc.documentElement.dataset.ardiaShape = state?.maximized || state?.fullScreen ? "square" : "round";
  doc.documentElement.dataset.ardiaDark = String(appDark());
}

addNativeListener(MODULE, "onWindowEvent", (payload) => {
  const event = payload as WindowEvent | null;
  if (!event?.id || (event.type !== "maximized" && event.type !== "fullScreen")) return;
  const state = squared.get(event.id) ?? { maximized: false, fullScreen: false };
  squared.set(event.id, event.type === "maximized" ? { ...state, maximized: !!event.on } : { ...state, fullScreen: !!event.on });
  applyShape(event.id);
});

onAppDarkChange(() => {
  for (const id of mounted.keys()) applyShape(id);
});

const rootOf = (realm: Realm) => realm.document.getElementById("root");

function prepareDocument(realm: Realm, id: string, options: OpenOptions) {
  const doc = realm.document;
  doc.title = options.title || "Ardia";
  doc.documentElement.lang = navigator.language || "en";
  doc.documentElement.dataset.ardiaWindow = id;
  doc.documentElement.dataset.ardiaKind = options.kind ?? "browser";
  if (!doc.head.querySelector("meta[charset]")) {
    const charset = doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    doc.head.prepend(charset);
  }
  mirrorStylesInto(doc);
  let root = rootOf(realm);
  if (!root) {
    root = doc.createElement("div");
    root.id = "root";
    doc.body.appendChild(root);
  }
  return root;
}

function fade(realm: Realm, from: number, to: number, ms: number): Promise<void> {
  const root = rootOf(realm);
  if (!root || ms <= 0 || realm.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (root) root.style.opacity = to === 1 ? "" : String(to);
    return Promise.resolve();
  }
  const animation = root.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: to > from ? "cubic-bezier(0.2, 0, 0, 1)" : "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  return animation.finished.then(
    () => {
      root.style.opacity = to === 1 ? "" : String(to);
      animation.cancel();
    },
    () => {},
  );
}

function show(id: string, entry: Mounted, animated: boolean) {
  if (entry.shown || entry.realm.closed) return;
  entry.shown = true;
  callMainSync(MODULE, "showWindow", id);
  const kind = kinds.get(id) === "small" ? "small" : "browser";
  if (animated) void fade(entry.realm, 0, 1, ENTRANCE_MS[kind]);
}

function showAfterFirstPaint(id: string, entry: Mounted, animated: boolean) {
  const fallback = setTimeout(() => show(id, entry, animated), SHOW_FALLBACK_MS);
  entry.realm.requestAnimationFrame(() =>
    entry.realm.requestAnimationFrame(() => {
      clearTimeout(fallback);
      show(id, entry, animated);
    }),
  );
}

function unmount(id: string, realm: Realm) {
  const entry = mounted.get(id);
  if (!entry || entry.realm !== realm) return;
  mounted.delete(id);
  squared.delete(id);
  try {
    entry.root?.unmount();
  } catch (error) {
    console.error(`[ardia linux] window ${id} did not unmount cleanly`, error);
  }
  stopMirroring(realm.document);
  forgetAppWindow(realm);
}

const registered = () => AppRegistry.getAppKeys().includes(APP_KEY);

async function untilRegistered() {
  for (let tries = 0; !registered() && tries < REGISTER_TRIES; tries++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function openWindow(id: string, options: OpenOptions = {}): Promise<void> {
  if (!registered()) await untilRegistered();
  const open = mounted.get(id);
  if (open && !open.realm.closed) {
    if (options.focus !== false) await focusWindow(id);
    return;
  }
  kinds.set(id, options.kind ?? "browser");
  callMainSync(MODULE, "shapeWindow", id, JSON.parse(JSON.stringify(options)));
  const realm = window.open("about:blank", id) as Realm | null;
  if (!realm) throw new Error(`window ${id} could not open`);
  const rootTag = prepareDocument(realm, id, options);
  const animated = options.animated === true || options.kind === "small";
  if (animated) rootTag.style.opacity = "0";
  adoptAppWindow(realm);
  const entry: Mounted = { realm, root: null, shown: false };
  mounted.set(id, entry);
  squared.set(id, { maximized: !!callMainSync(MODULE, "isMaximized", id), fullScreen: false });
  applyShape(id);
  realm.addEventListener("pagehide", () => unmount(id, realm));
  entry.root = AppRegistry.runApplication(APP_KEY, { rootTag, initialProps: { windowId: id } }) as unknown as { unmount(): void };
  showAfterFirstPaint(id, entry, animated);
}

export async function focusWindow(id: string): Promise<void> {
  const entry = mounted.get(id);
  const root = entry && rootOf(entry.realm);
  if (root) {
    root.getAnimations().forEach((animation) => animation.cancel());
    root.style.opacity = "";
  }
  await callMain(MODULE, "focusWindow", id);
}

export async function closeWindow(id: string, closeInMain: ((id: string) => unknown) | null): Promise<void> {
  const entry = mounted.get(id);
  if (entry) unmount(id, entry.realm);
  if (closeInMain) await closeInMain(id);
  else entry?.realm.close();
}

export async function animateWindowClose(id: string): Promise<void> {
  const entry = mounted.get(id);
  if (!entry || entry.realm.closed) return;
  const kind = kinds.get(id) === "small" ? "small" : "browser";
  await fade(entry.realm, 1, 0, EXIT_MS[kind]);
}

export const appWindowDocument = (id: string): Document | null => {
  const entry = mounted.get(id);
  return entry && !entry.realm.closed ? entry.realm.document : null;
};

export const mountedWindowIds = () => [...mounted.keys()];

export function windowIdOfNode(node: Node | null | undefined): string {
  const doc = node?.ownerDocument ?? (node as Document | null);
  return doc?.documentElement?.dataset.ardiaWindow ?? "";
}
