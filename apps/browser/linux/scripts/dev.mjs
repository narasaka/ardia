import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

await import("./build-main.mjs");
const server = await createServer({ configFile: `${root}renderer/vite.config.ts` });
await server.listen();
const url = server.resolvedUrls?.local[0];
const electron = spawn(require("electron"), [root, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, ARDIA_DEV_SERVER: url } });
electron.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
