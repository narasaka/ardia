type Movable = Node & { moveBefore?: (node: Node, child: Node | null) => void };

const patchedRealms = new WeakSet<object>();
const parkingLots = new WeakMap<Document, HTMLElement>();

const holdsPage = (node: Node) =>
  node instanceof (node.ownerDocument?.defaultView ?? window).Element && ((node as Element).localName === "webview" || !!(node as Element).querySelector("webview"));

function movedInPlace(parent: Movable, node: Node, child: Node | null): boolean {
  if (typeof parent.moveBefore !== "function" || !node.isConnected || !parent.isConnected || node.ownerDocument !== parent.ownerDocument || !holdsPage(node)) return false;
  try {
    parent.moveBefore(node, child);
    return true;
  } catch {
    return false;
  }
}

export function keepPagesOnMoveIn(realm: Window & typeof globalThis) {
  const proto = realm.Node?.prototype;
  if (!proto || patchedRealms.has(proto)) return;
  patchedRealms.add(proto);
  const insertBefore = proto.insertBefore;
  const appendChild = proto.appendChild;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
    if (movedInPlace(this, node, child)) return node;
    return insertBefore.call(this, node, child) as T;
  };
  proto.appendChild = function <T extends Node>(this: Node, node: T): T {
    if (movedInPlace(this, node, null)) return node;
    return appendChild.call(this, node) as T;
  };
}

export function parkingLotOf(doc: Document): HTMLElement {
  let lot = parkingLots.get(doc);
  if (lot && lot.isConnected) return lot;
  lot = doc.createElement("div");
  lot.setAttribute("data-ardia-parked-pages", "");
  lot.style.cssText = "position:fixed;left:-20000px;top:0;width:800px;height:600px;overflow:hidden;visibility:hidden;pointer-events:none;";
  doc.body.appendChild(lot);
  parkingLots.set(doc, lot);
  return lot;
}

export function moveWithin(parent: Element, node: Element): boolean {
  if (node.parentNode === parent) return true;
  const target = parent as Movable;
  if (node.isConnected && node.ownerDocument === parent.ownerDocument && typeof target.moveBefore === "function") {
    try {
      target.moveBefore(node, null);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
