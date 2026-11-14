const bridge = (globalThis as { ardiaLinux?: { modules(): unknown } }).ardiaLinux;
console.log("[ardia linux] host up, modules:", JSON.stringify(bridge?.modules()));
