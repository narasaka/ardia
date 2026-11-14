import { ipcMain, type WebContents } from "electron";

type Method = (...args: never[]) => unknown;
export type ModuleSpec = {
  sync?: Record<string, Method>;
  async?: Record<string, Method>;
  constants?: Record<string, unknown>;
};

export type ModuleShape = { sync: string[]; async: string[]; constants?: Record<string, unknown> };

const modules = new Map<string, ModuleSpec>();
const receivers = new Set<WebContents>();

export function defineModule(name: string, spec: ModuleSpec): void {
  const known = modules.get(name);
  modules.set(name, {
    sync: { ...known?.sync, ...spec.sync },
    async: { ...known?.async, ...spec.async },
    constants: { ...known?.constants, ...spec.constants },
  });
}

export function emit(module: string, event: string, payload: unknown): void {
  for (const receiver of receivers) if (!receiver.isDestroyed()) receiver.send("ardia:event", module, event, payload);
}

export function addReceiver(contents: WebContents): void {
  receivers.add(contents);
  contents.once("destroyed", () => receivers.delete(contents));
}

function shapes(): Record<string, ModuleShape> {
  const out: Record<string, ModuleShape> = {};
  for (const [name, spec] of modules)
    out[name] = { sync: Object.keys(spec.sync ?? {}), async: Object.keys(spec.async ?? {}), constants: spec.constants };
  return out;
}

const failure = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error), code: (error as { code?: string })?.code });

export function installBridge(): void {
  ipcMain.on("ardia:modules", (event) => {
    event.returnValue = shapes();
  });
  ipcMain.on("ardia:callSync", (event, module: string, method: string, args: unknown[]) => {
    const run = modules.get(module)?.sync?.[method];
    if (!run) {
      event.returnValue = failure(new Error(`${module}.${method} has no sync version on Linux`));
      return;
    }
    try {
      event.returnValue = { value: run(...(args as never[])) };
    } catch (error) {
      event.returnValue = failure(error);
    }
  });
  ipcMain.handle("ardia:call", async (_event, module: string, method: string, args: unknown[]) => {
    const run = modules.get(module)?.async?.[method] ?? modules.get(module)?.sync?.[method];
    if (!run) return failure(new Error(`${module}.${method} is not on Linux`));
    try {
      return { value: await run(...(args as never[])) };
    } catch (error) {
      return failure(error);
    }
  });
}
