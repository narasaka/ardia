type EventListener = (module: string, event: string, payload: unknown) => void;

export type LinuxBridge = {
  modules(): Record<string, { sync: string[]; async: string[]; constants?: Record<string, unknown> }>;
  callSync(module: string, method: string, args: unknown[]): unknown;
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  onEvent(listener: EventListener): () => void;
};

export const PAGES_MODULE = "ArdiaLinuxPages";

export const linuxBridge = (): LinuxBridge | undefined => (globalThis as { ardiaLinux?: LinuxBridge }).ardiaLinux;

export function pagesCallSync<Result>(method: string, ...args: unknown[]): Result | undefined {
  const bridge = linuxBridge();
  if (!bridge) return undefined;
  return bridge.callSync(PAGES_MODULE, method, args) as Result;
}

export async function pagesCall<Result>(method: string, ...args: unknown[]): Promise<Result | null> {
  const bridge = linuxBridge();
  if (!bridge) return null;
  return (await bridge.call(PAGES_MODULE, method, args)) as Result;
}
