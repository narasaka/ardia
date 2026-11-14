import { BrowserWindow, screen } from "electron";
import { defineModule } from "../bridge";
import { appWindow } from "../windows";
import { keyboardState, setEscapeCapture, setSwitcherCapture, setTextInputFocused } from "../menus/keyboard";

const SWITCHER_POINTER_SLOP = 4;
let switcherPointerStart: Electron.Point | null = null;

function takeKeyboardFromPage(windowId: string): boolean {
  const window = appWindow(windowId);
  if (!window || window.isDestroyed()) return false;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused !== window) return false;
  window.webContents.focus();
  return true;
}

function switcherPointerMoved(): boolean {
  if (!switcherPointerStart) return false;
  const now = screen.getCursorScreenPoint();
  return Math.abs(now.x - switcherPointerStart.x) > SWITCHER_POINTER_SLOP || Math.abs(now.y - switcherPointerStart.y) > SWITCHER_POINTER_SLOP;
}

defineModule("ArdiaFocus", {
  sync: {
    textInputFocused: () => keyboardState.textInputFocused,
    switcherPointerMoved,
    pressesWithoutRelease: () => 0,
  },
  async: {
    setDragEscapeCapture: async (active: boolean) => setEscapeCapture(!!active),
    setSwitcherCapture: async (active: boolean) => {
      switcherPointerStart = active ? screen.getCursorScreenPoint() : null;
      setSwitcherCapture(!!active);
    },
    setTextInputFocused: async (focused: boolean) => setTextInputFocused(!!focused),
    takeKeyboardFromPage: async (windowId: string) => takeKeyboardFromPage(windowId),
    cancelFocusMove: async () => {},
    claimFocus: async () => {},
    saveKeyResponder: async () => 0,
    restoreKeyResponder: async () => false,
    discardKeyResponder: async () => {},
    pressRepeated: async () => null,
  },
});
