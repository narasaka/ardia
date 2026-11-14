export type ModuleShape = { sync: string[]; async: string[]; constants?: Record<string, unknown> };

export type LinuxBridge = {
  modules(): Record<string, ModuleShape>;
  callSync(module: string, method: string, args: unknown[]): unknown;
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  onEvent(listener: (module: string, event: string, payload: unknown) => void): () => void;
};

let shapes: Record<string, ModuleShape> | null = null;

export const bridge = (): LinuxBridge | null => (globalThis as { ardiaLinux?: LinuxBridge }).ardiaLinux ?? null;

export const mainModules = (): Record<string, ModuleShape> => (shapes ??= bridge()?.modules() ?? {});

export function callMainSync<Value = unknown>(module: string, method: string, ...args: unknown[]): Value | undefined {
  const linux = bridge();
  if (!linux || !mainModules()[module]?.sync.includes(method)) return undefined;
  return linux.callSync(module, method, args) as Value;
}

export async function callMain<Value = unknown>(module: string, method: string, ...args: unknown[]): Promise<Value | undefined> {
  const linux = bridge();
  const shape = mainModules()[module];
  if (!linux || !(shape?.async.includes(method) || shape?.sync.includes(method))) return undefined;
  return (await linux.call(module, method, args)) as Value;
}
