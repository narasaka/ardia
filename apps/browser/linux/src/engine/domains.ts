import { defineModule, emit } from "../bridge";

export type DomainHandler = (args: Record<string, unknown>, profile: string) => unknown;

const moduleName = (domain: string) => `Ardia${domain[0]!.toUpperCase()}${domain.slice(1)}`;

const domains = new Map<string, Record<string, DomainHandler>>();
const missingLogged = new Set<string>();

function noteMissing(domain: string, verb: string) {
  const name = `${domain}.${verb}`;
  if (missingLogged.has(name)) return;
  missingLogged.add(name);
  console.warn(`[ardia linux] ${name} is not on Linux yet`);
}

export const missingDomainCalls = (): string[] => [...missingLogged].sort();

export function defineDomain(domain: string, handlers: Record<string, DomainHandler>): void {
  const known = domains.get(domain);
  if (known) {
    Object.assign(known, handlers);
    return;
  }
  const own = { ...handlers };
  domains.set(domain, own);
  defineModule(moduleName(domain), {
    async: {
      call: async (verb: string, profile: string, argsJson: string) => {
        const handler = own[verb];
        if (!handler) {
          noteMissing(domain, verb);
          throw Object.assign(new Error(`${domain}.${verb} is not on Linux yet`), { code: "ERR_ENGINE" });
        }
        const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
        return JSON.stringify((await handler(args, profile ?? "")) ?? null);
      },
    },
  });
}

export function emitDomainEvent(name: string, data: unknown): void {
  const domain = name.slice(0, name.indexOf("."));
  emit(moduleName(domain), domain, { name, data });
}
