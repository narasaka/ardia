import { APP_VERSION } from "../build";
import { defineModule } from "../bridge";

defineModule("ArdiaCli", {
  sync: { installedVersion: () => null, canInstallUnattended: () => false },
  async: { install: async () => ({ ok: false, appVersion: APP_VERSION, error: "The ardia command isn't on Linux yet", installedVersion: null, lines: [] }) },
});

defineModule("ArdiaScripting", {
  sync: { setScriptState: () => {} },
});
