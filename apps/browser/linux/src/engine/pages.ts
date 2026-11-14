export type PageEvent =
  | { type: "navigated"; profile: string; tabId: string; url: string; title: string; transition: string; isMainFrame: boolean }
  | { type: "title"; profile: string; tabId: string; url: string; title: string }
  | { type: "favicon"; profile: string; tabId: string; url: string; icons: string[] }
  | { type: "closed"; profile: string; tabId: string };

type PageListener = (event: PageEvent) => void;
const listeners = new Set<PageListener>();

export function onPage(listener: PageListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function emitPage(event: PageEvent): void {
  for (const listener of listeners) listener(event);
}
