import { appWindow } from "./windows";

export function focusAppWindow(windowId: string): boolean {
  const window = appWindow(windowId);
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}
