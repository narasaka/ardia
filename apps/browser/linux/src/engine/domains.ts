import { defineModule, emit } from "../bridge";

export type DomainHandler = (args: Record<string, unknown>, profile: string) => unknown;

const moduleName = (domain: string) => `Ardia${domain[0]!.toUpperCase()}${domain.slice(1)}`;

export function defineDomain(domain: string, handlers: Record<string, DomainHandler>): void {
  defineModule(moduleName(domain), {
    async: {
      call: async (verb: string, profile: string, argsJson: string) => {
        const handler = handlers[verb];
        if (!handler) throw Object.assign(new Error(`${domain}.${verb} is not on Linux yet`), { code: "ERR_ENGINE" });
        const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
        return JSON.stringify((await handler(args, profile)) ?? null);
      },
    },
  });
}

export function emitDomainEvent(name: string, data: unknown): void {
  const domain = name.slice(0, name.indexOf("."));
  emit(moduleName(domain), domain, { name, data });
}
