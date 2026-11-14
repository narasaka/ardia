import { writeFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { defineDomain } from "../engine/domains";
import { savedDatabase, transaction } from "./database";
import { askSavePath } from "./dialogs";
import { engineError } from "./profiles";

type Node = { id: string; parent: string | null; position: number; kind: "u" | "f"; title: string; url: string | null; added: number; key: string | null };
type Tree = { id: string; k: "u" | "f"; t: string; u?: string; a: number; key?: string; c?: Tree[] };
type Op = { op?: unknown; id?: unknown; k?: unknown; t?: unknown; u?: unknown; a?: unknown; key?: unknown; parent?: unknown; index?: unknown; ifAbsent?: unknown };
type Result = "applied" | "failed" | "invalid";

const PERMANENT: Record<string, string> = { bar: "Bookmarks bar", other: "Other bookmarks" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DEPTH = 512;

function bookmarksOf(profile: string): DatabaseSync {
  const db = savedDatabase(profile);
  const insert = db.prepare("INSERT OR IGNORE INTO bookmarks (id, parent, position, kind, title, added) VALUES (?, NULL, ?, 'f', ?, ?)");
  Object.entries(PERMANENT).forEach(([id, title], position) => insert.run(id, position, title, Date.now()));
  return db;
}

const nodeOf = (db: DatabaseSync, id: string) => db.prepare("SELECT * FROM bookmarks WHERE id = ?").get(id) as Node | undefined;
const childIds = (db: DatabaseSync, parent: string) => (db.prepare("SELECT id FROM bookmarks WHERE parent = ? ORDER BY position").all(parent) as { id: string }[]).map((row) => row.id);

function writePositions(db: DatabaseSync, parent: string, ids: string[]) {
  const set = db.prepare("UPDATE bookmarks SET parent = ?, position = ? WHERE id = ?");
  ids.forEach((id, position) => set.run(parent, position, id));
}

function placeAt(db: DatabaseSync, id: string, parent: string, index: number) {
  const node = nodeOf(db, id);
  if (node?.parent) writePositions(db, node.parent, childIds(db, node.parent).filter((child) => child !== id));
  const siblings = childIds(db, parent).filter((child) => child !== id);
  siblings.splice(Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : siblings.length, siblings.length)), 0, id);
  writePositions(db, parent, siblings);
}

function isAncestor(db: DatabaseSync, node: string, of: string): boolean {
  let at: string | null | undefined = of;
  for (let depth = 0; at && depth <= MAX_DEPTH; depth++) {
    if (at === node) return true;
    at = nodeOf(db, at)?.parent;
  }
  return false;
}

const isValidUrl = (url: unknown): url is string => {
  if (typeof url !== "string" || !url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

function update(db: DatabaseSync, node: Node, title: unknown, url: unknown) {
  if (typeof title === "string") db.prepare("UPDATE bookmarks SET title = ? WHERE id = ?").run(title, node.id);
  if (node.kind === "u" && isValidUrl(url)) db.prepare("UPDATE bookmarks SET url = ? WHERE id = ?").run(url, node.id);
}

function removeTree(db: DatabaseSync, id: string) {
  db.prepare(
    "WITH RECURSIVE gone(id) AS (SELECT ? UNION ALL SELECT b.id FROM bookmarks b JOIN gone ON b.parent = gone.id) DELETE FROM bookmarks WHERE id IN (SELECT id FROM gone)",
  ).run(id);
}

function apply(db: DatabaseSync, op: Op): Result {
  const id = op.id as string;
  const node = nodeOf(db, id);
  const permanent = Object.hasOwn(PERMANENT, id);
  if (op.op === "remove") {
    if (!node || permanent) return "failed";
    const parent = node.parent;
    removeTree(db, id);
    if (parent) writePositions(db, parent, childIds(db, parent));
    return "applied";
  }
  if (op.op === "update") {
    if (!node || permanent) return "failed";
    update(db, node, op.t, op.u);
    return "applied";
  }
  const parentId = typeof op.parent === "string" ? op.parent : "";
  const parent = parentId ? nodeOf(db, parentId) : undefined;
  if (!parent || parent.kind !== "f") return "failed";
  const index = typeof op.index === "number" ? op.index : childIds(db, parentId).length;
  if (op.op === "move") {
    if (!node || permanent || isAncestor(db, id, parentId)) return "failed";
    placeAt(db, id, parentId, index);
    return "applied";
  }
  if (node && op.ifAbsent === true) return "applied";
  if (node) {
    if (permanent || isAncestor(db, id, parentId)) return "failed";
    placeAt(db, id, parentId, index);
    update(db, node, typeof op.t === "string" ? op.t : "", op.u);
    return "applied";
  }
  if (!UUID.test(id)) return "failed";
  const folder = op.k === "f";
  if (!folder && !isValidUrl(op.u)) return "invalid";
  const added = typeof op.a === "number" && op.a > 0 ? op.a : Date.now();
  const key = typeof op.key === "string" && op.key ? op.key : null;
  db.prepare("INSERT INTO bookmarks (id, parent, position, kind, title, url, added, key) VALUES (?, ?, 0, ?, ?, ?, ?, ?)").run(
    id,
    parentId,
    folder ? "f" : "u",
    typeof op.t === "string" ? op.t : "",
    folder ? null : (op.u as string),
    Math.floor(added),
    key,
  );
  placeAt(db, id, parentId, index);
  return "applied";
}

function tree(db: DatabaseSync): { bar: Tree; other: Tree } {
  const rows = db.prepare("SELECT * FROM bookmarks ORDER BY parent, position").all() as Node[];
  const children = new Map<string, Node[]>();
  const byId = new Map<string, Node>();
  for (const row of rows) {
    byId.set(row.id, row);
    if (!row.parent) continue;
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent)!.push(row);
  }
  const build = (node: Node, depth: number): Tree => {
    if (depth > MAX_DEPTH) throw engineError("bookmarks nested too deep");
    const base = { id: node.id, t: node.title, a: Math.floor(node.added), ...(node.key ? { key: node.key } : {}) };
    if (node.kind === "u") return { ...base, k: "u", u: node.url ?? "" };
    return { ...base, k: "f", c: (children.get(node.id) ?? []).map((child) => build(child, depth + 1)) };
  };
  return { bar: build(byId.get("bar")!, 0), other: build(byId.get("other")!, 0) };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function netscapeHtml(root: { bar: Tree; other: Tree }): string {
  const seconds = (ms: number) => Math.floor(ms / 1000);
  const lines: string[] = [];
  const write = (node: Tree, indent: string, toolbar = false) => {
    if (node.k === "u") {
      lines.push(`${indent}<DT><A HREF="${escapeHtml(node.u ?? "")}" ADD_DATE="${seconds(node.a)}">${escapeHtml(node.t)}</A>`);
      return;
    }
    lines.push(`${indent}<DT><H3 ADD_DATE="${seconds(node.a)}"${toolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ""}>${escapeHtml(node.t)}</H3>`);
    lines.push(`${indent}<DL><p>`);
    for (const child of node.c ?? []) write(child, `${indent}    `);
    lines.push(`${indent}</DL><p>`);
  };
  write(root.bar, "    ", true);
  write(root.other, "    ");
  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    ...lines,
    "</DL><p>",
    "",
  ].join("\n");
}

defineDomain("bookmarks", {
  tree: (_args, profile) => tree(bookmarksOf(profile)),
  apply: (args, profile) => {
    const db = bookmarksOf(profile);
    const ops = Array.isArray(args.ops) ? (args.ops as Op[]) : [];
    ops.forEach((op, at) => {
      const known = op && typeof op === "object" && ["add", "update", "move", "remove"].includes(op.op as string) && typeof op.id === "string";
      if (!known) throw engineError(`bad op at ${at}`);
    });
    let applied = 0;
    const invalid: string[] = [];
    transaction(db, () => {
      for (const op of ops) {
        const result = apply(db, op);
        if (result === "applied") applied++;
        else if (result === "invalid") invalid.push(op.id as string);
        else break;
      }
    });
    return { applied, skipped: ops.length - applied - invalid.length, invalid };
  },
  watch: (_args, profile) => {
    bookmarksOf(profile);
    return null;
  },
  exportHtml: async (_args, profile) => {
    const html = netscapeHtml(tree(bookmarksOf(profile)));
    const path = await askSavePath("Ardia Bookmarks.html", [{ name: "Web page", extensions: ["html"] }]);
    if (!path) return null;
    await writeFile(path, html, "utf8");
    return path;
  },
});
