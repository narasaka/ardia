import { createContext, useContext, type ReactNode } from "react";
import { AppRegistry } from "react-native";

type AppParameters = { initialProps?: { windowId?: unknown } | null };

export const WindowIdContext = createContext("");

export const useWindowId = () => useContext(WindowIdContext);

const darkWindows = new Set<string>();

export function setWindowDark(windowId: string, dark: boolean) {
  if (dark) darkWindows.add(windowId);
  else darkWindows.delete(windowId);
}

export const isWindowDark = (windowId: string) => darkWindows.has(windowId);

let installed = false;

export function installWindowRoot() {
  if (installed) return;
  installed = true;
  AppRegistry.setWrapperComponentProvider((parameters: AppParameters) => {
    const windowId = typeof parameters?.initialProps?.windowId === "string" ? parameters.initialProps.windowId : "";
    return function LinuxWindowRoot({ children }: { children?: ReactNode }) {
      return <WindowIdContext.Provider value={windowId}>{children}</WindowIdContext.Provider>;
    };
  });
}
