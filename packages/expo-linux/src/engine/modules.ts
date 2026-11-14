import type { ComponentType } from "react";
import { ArdiaWebView } from "./ArdiaWebView";
import { focusPage, parkPage, releasePage } from "./pages";

export const engineModules: Record<string, Record<string, unknown>> = {
  ArdiaTabs: {
    prepareTransfer: (tabId: string) => parkPage(tabId),
    releaseTransfer: (tabId: string) => releasePage(tabId),
    claimLaunchTab: () => {},
    revealTab: () => {},
    dropTabReveals: () => {},
    revealOffered: () => {},
    discardOffered: async () => true,
    followKeyboard: (tabId: string) => void focusPage(tabId),
  },
};

export const engineViews: Record<string, ComponentType<never>> = {
  ArdiaWebView: ArdiaWebView as unknown as ComponentType<never>,
};
