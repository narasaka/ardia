import { emitNativeEvent } from "../../events";
import { appWindowDocument } from "../../windows/appWindows";
import { currentPointer, watchPointer, type PointerSample } from "../../reactNative/pointer";

const REACH = 24;
const HOLDING_CLASS = "ardia-pointer-hold";

type Watch = { hold: number; right: boolean };

const watched = new Map<string, Watch>();
const over = new Set<string>();
const unreported = new Set<string>();
let stopWatching: (() => void) | null = null;

function isOver(doc: Document | null, pointer: PointerSample | null, { hold, right }: Watch) {
  if (!doc || !pointer || pointer.doc !== doc || doc.fullscreenElement) return false;
  const width = doc.documentElement.clientWidth;
  const height = doc.documentElement.clientHeight;
  const x = pointer.clientX;
  const y = pointer.clientY;
  if (y < 0 || y >= height) return false;
  if (right) return x < width && x >= width - Math.max(hold, REACH / 2);
  return x >= 0 && x < Math.max(hold, REACH / 2);
}

function check(pointer: PointerSample | null = currentPointer()) {
  for (const [id, watch] of [...watched]) {
    if (!watched.has(id)) continue;
    const doc = appWindowDocument(id);
    const now = isOver(doc, pointer, watch);
    const fresh = unreported.delete(id);
    if (!fresh && now === over.has(id)) continue;
    if (now) over.add(id);
    else over.delete(id);
    const mine = pointer && pointer.doc === doc;
    const point: [number, number] = mine ? [pointer.clientX, pointer.clientY] : [-1, -1];
    emitNativeEvent("ArdiaAppWindows", "onWindowEvent", { type: "sidebarEdge", id, over: now, point });
  }
}

function holdPagePointer(id: string) {
  const doc = appWindowDocument(id);
  if (!doc) return;
  const holding = (watched.get(id)?.hold ?? 0) > 0;
  if (holding && !doc.getElementById(HOLDING_CLASS)) {
    const style = doc.createElement("style");
    style.id = HOLDING_CLASS;
    style.textContent = `.${HOLDING_CLASS} webview, .${HOLDING_CLASS} iframe { pointer-events: none !important; }`;
    doc.head.append(style);
  }
  doc.documentElement.classList.toggle(HOLDING_CLASS, holding);
}

function listen(on: boolean) {
  if (on === !!stopWatching) return;
  if (on) stopWatching = watchPointer(check);
  else {
    stopWatching?.();
    stopWatching = null;
  }
}

export function watchSidebarEdge(id: string, on: boolean, hold: number, right: boolean) {
  if (on) {
    watched.set(id, { hold: Math.max(0, hold), right });
    unreported.add(id);
  } else {
    watched.delete(id);
    over.delete(id);
  }
  listen(watched.size > 0);
  holdPagePointer(id);
  if (watched.size) check();
}
