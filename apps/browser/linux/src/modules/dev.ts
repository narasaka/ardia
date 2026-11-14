import { writeFileSync } from "node:fs";
import { defineModule } from "../bridge";
import { launchConfig } from "../launch";
import { readKeyPress, type ElectronInput } from "../menus/keys";
import { dispatch, emitCommand, keyboardState } from "../menus/keyboard";
import { menuStore } from "../menus/store";
import { appWindow } from "../windows";

type KeyPress = { key: string; keyCode?: number; modifiers?: string[]; characters?: string; dry?: boolean };

const testOnly = () => {
  if (!launchConfig().testInstance) throw Object.assign(new Error("dev calls are for test instances"), { code: "ERR_NOT_TEST_INSTANCE" });
};

const CODES: Record<string, string> = {
  "[": "BracketLeft", "]": "BracketRight", "{": "BracketLeft", "}": "BracketRight", "=": "Equal", "+": "Equal", "-": "Minus", ",": "Comma", ".": "Period",
  "/": "Slash", ";": "Semicolon", "'": "Quote", "\\": "Backslash", "`": "Backquote", " ": "Space", "\t": "Tab", "\r": "Enter", "\u001b": "Escape",
  "": "ArrowLeft", "": "ArrowRight", "": "ArrowUp", "": "ArrowDown", "": "PageUp", "": "PageDown", "\b": "Backspace", "": "Delete",
};

function inputOf(press: KeyPress): ElectronInput {
  const modifiers = press.modifiers ?? [];
  const key = press.characters ?? press.key;
  const code =
    /^[a-z]$/i.test(press.key) ? `Key${press.key.toUpperCase()}` : /^\d$/.test(press.key) ? `Digit${press.key}` : (CODES[press.key] ?? (/^f\d{1,2}$/i.test(press.key) ? press.key.toUpperCase() : press.key));
  return {
    type: "keyDown",
    key,
    code,
    shift: modifiers.includes("shift"),
    control: modifiers.includes("control") || modifiers.includes("command"),
    alt: modifiers.includes("option"),
    meta: false,
  };
}

async function devKeyEquivalent(windowId: string, press: KeyPress) {
  testOnly();
  const window = appWindow(windowId) ?? null;
  const keyPress = readKeyPress(inputOf(press));
  const entry = menuStore.match(keyPress);
  const matched = entry ? [{ title: entry.title, action: entry.id, command: entry.command, arg: entry.arg ?? undefined, enabled: menuStore.entryEnabled(entry) }] : [];
  if (press.dry || !entry) return { handledBy: entry ? "menu" : "none", matched, fired: [] };
  const handled = dispatch(keyPress, window);
  return { handledBy: handled ? "menu" : "none", matched, fired: handled ? [{ title: entry.title, action: entry.id, command: entry.command, arg: entry.arg ?? undefined }] : [] };
}

async function devSnapshotWindow(windowId: string, path: string): Promise<boolean> {
  testOnly();
  const window = appWindow(windowId);
  if (!window || window.isDestroyed()) return false;
  const image = await window.webContents.capturePage();
  writeFileSync(path, image.toPNG());
  return true;
}

defineModule("ArdiaDev", {
  async: {
    devMenuCommand: async (command: string, arg: string | null) => {
      testOnly();
      emitCommand(command, arg ?? null, null);
    },
    devKeyEquivalent,
    devSnapshotWindow,
    devShortcutRecording: async () => keyboardState.recording !== null,
    devCrash: async () => {
      testOnly();
      process.crash();
    },
  },
});
