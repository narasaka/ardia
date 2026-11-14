import type { ComponentType } from "react";
import { wireMainEvents } from "./events";
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

export const uuid = {
  v4(): string {
    return crypto.randomUUID();
  },
};
