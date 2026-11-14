import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.ARDIA_VITE_PORT ?? 5281), strictPort: false },
  build: { outDir: here("../ui"), emptyOutDir: true, target: "chrome140", sourcemap: true },
});
