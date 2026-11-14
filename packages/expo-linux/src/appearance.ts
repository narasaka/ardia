import { useSyncExternalStore } from "react";
import { isWindowDark, useWindowId } from "./windows/windowRoot";
import { addNativeListener } from "./events";

type AppEvent = { type?: string; dark?: unknown };

const listeners = new Set<() => void>();
const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
let dark = !!query?.matches;
let chosen = false;

function set(next: boolean) {
  if (next === dark) return;
  dark = next;
  for (const listener of [...listeners]) listener();
}

query?.addEventListener("change", (e) => {
  if (!chosen) set(e.matches);
});

addNativeListener("ArdiaShell", "onAppEvent", (payload) => {
  const event = payload as AppEvent | null;
  if (event?.type !== "appearance" || typeof event.dark !== "boolean") return;
  chosen = true;
  set(event.dark);
});

export const appDark = () => dark;

export function onAppDarkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useAppDark(): boolean {
  const app = useSyncExternalStore(onAppDarkChange, appDark);
  return isWindowDark(useWindowId()) || app;
}
