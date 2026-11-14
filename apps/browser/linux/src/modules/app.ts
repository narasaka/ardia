import { app } from "electron";
import { defineModule } from "../bridge";
import { configDirectory, dataDirectory, isBackground } from "../paths";

defineModule("ArdiaLinuxHost", {
  sync: {
    dataDirectory: () => dataDirectory(),
    configDirectory: () => configDirectory(),
    background: () => isBackground(),
    version: () => app.getVersion(),
  },
});
