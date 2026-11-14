import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const electron = require("electron");

process.env.ARDIA_DEBUG_BUILD = "1";
await import("./build-main.mjs");

const [sandboxFlags = "", sandboxReason = ""] = execFileSync(
  "bash",
  ["-c", 'source "$1"; ardia_sandbox_decide "$2"; printf "%s\\n%s" "${ARDIA_SANDBOX_FLAGS[*]}" "$ARDIA_SANDBOX_REASON"', "sandbox", `${root}packaging/sandbox.sh`, electron],
  { encoding: "utf8" },
).split("\n");
const server = await createServer({ configFile: `${root}renderer/vite.config.ts` });
await server.listen();
const url = server.resolvedUrls?.local[0];
const flags = sandboxFlags ? sandboxFlags.split(" ") : [];
const child = spawn(electron, [...flags, root, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, ARDIA_DEV_SERVER: url, ARDIA_SANDBOX_REASON: sandboxReason } });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
