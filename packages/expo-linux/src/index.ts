import type { ComponentType } from "react";
import { emitNativeEvent, wireMainEvents } from "./events";
import { requireNativeModule } from "./modules";
import { viewNamed } from "./views/registry";
import { installWindowRoot } from "./windows/windowRoot";

export type { EventSubscription } from "./events";
export { emitNativeEvent } from "./events";
export { missingOnLinux } from "./missing";
export { requireNativeModule, requireOptionalNativeModule } from "./modules";

export function requireNativeViewManager<Props = object>(name: string): ComponentType<Props> {
  return viewNamed<Props>(name);
}

wireMainEvents();
installWindowRoot();

Object.assign(globalThis, {
  ardiaLinuxDebug: {
    module: requireNativeModule,
    emit: emitNativeEvent,
    command: (command: string, arg: string | null = null, windowId: string | null = null) => emitNativeEvent("ArdiaMenus", "onCommand", { command, arg, windowId, focusGeneration: null }),
  },
});

export const uuid = {
  v4(): string {
    return crypto.randomUUID();
  },
};
