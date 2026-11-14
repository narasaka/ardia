# Ardia on Linux

The Linux port shares the Mac's and Windows' TypeScript UI (`apps/browser/src`, `packages/*/src`) and is laid out like
the Windows port (`docs/windows.md`): an app project under `apps/browser/linux`, an `expo-modules-core` replacement in
`packages/expo-linux`, platform files named `*.linux.ts(x)` beside the shared ones, scripts in `scripts/linux`, CI in
`.github/workflows/linux.yml`. The work lands on the `linux` branch of the fork, which starts from the Windows branch
(PR #1116) so the shared platform layer (`lib/platformFeatures`, `lib/platformChrome`, `lib/platformTerms`,
`platform/windowControls`, the app-drawn window buttons) serves both.

## Design

| Layer | Linux |
| --- | --- |
| Process and engine | Electron (Chromium + Node), `apps/browser/linux` |
| UI | The shared TypeScript, bundled by Vite for the browser with `react-native-web`, run in one renderer |
| `expo-modules-core` | `packages/expo-linux`: native modules are the main process's, reached through the preload bridge |
| Pages | Electron `<webview>` elements inside the UI's DOM, one per tab, partition `persist:<profile>` |
| Windows | Frameless `BrowserWindow`s, each a child the one UI runtime opened and renders into |
| Chrome services | Written in TypeScript in the main process (history, bookmarks, favicons, downloads, permissions, passwords) |

### One runtime, many windows

The Mac and Windows run one JS runtime that mounts a root per window. On Linux one hidden `BrowserWindow`, the host,
loads the UI bundle. Every app window (browser, Little Ardia, Settings, Import) is opened from the host with
`window.open('about:blank', <windowId>)`: Electron keeps it in the host's renderer process and same origin, so the host
mounts a React root into the child's document, and every window shares the one zustand store. The main process
shapes those windows in `setWindowOpenHandler` (frameless, transparent, sizes from `ArdiaAppWindows.openWindow`).
Closing a window unmounts its root. The host is never shown and lives until quit.

Styles that `react-native-web` injects into the host document are mirrored into each child document. Code that listens
on `window`/`document` for keys, pointer or focus does so on the window it serves.

### Pages are `<webview>` elements

`ArdiaWebView` renders a `<webview>` in place, so the UI draws over pages, clips their corners and animates them like
any other element. The main process owns each page's `webContents` (`webContents.fromId(getWebContentsId())`) and
answers the engine domains (`tabs.*`, `history.*`, …) from it.

### The bridge

`apps/browser/linux/src/preload.ts` gives the host renderer `window.ardiaLinux`:

```ts
type LinuxBridge = {
  modules(): Record<string, { sync: string[]; async: string[]; constants?: Record<string, unknown> }>;
  callSync(module: string, method: string, args: unknown[]): unknown;
  call(module: string, method: string, args: unknown[]): Promise<unknown>;
  onEvent(listener: (module: string, event: string, payload: unknown) => void): () => void;
};
```

Main-process modules live one per file in `apps/browser/linux/src/modules/<Name>.ts` and register with
`defineModule(name, { sync, async, constants })`. A module emits events with `emit(module, event, payload)`, which
reaches JS as `emitNativeEvent(module, event, payload)`, the same channel the Mac's `addListener` uses. In
`packages/expo-linux`, `requireNativeModule(name)` answers each property in this order: the main process's module
(sync methods through `callSync`, async through `call`), modules written in TypeScript, the engine's modules,
`defaults.ts`, then an inert method that logs its name once (`ardiaLinuxMissing()` in the console lists them).

## Paths

Data in `$XDG_DATA_HOME/ardia` (default `~/.local/share/ardia`) or `ARDIA_DATA_DIR`, config in
`$XDG_CONFIG_HOME/ardia`. Test instances always set `ARDIA_DATA_DIR`.

## Running it

- `pnpm -C apps/browser/linux dev`: Vite serves the UI, Electron loads it.
- `pnpm -C apps/browser/linux build`: the UI bundle and the main process, then `package` makes the AppImage and `.deb`
  in `apps/browser/linux/dist`.
- Headless: `scripts/linux/xvfb <display> -- <command>` runs a command on a virtual display;
  `scripts/linux/test-instance` starts a hidden instance with its own data dir and a remote debugging port, and
  `scripts/linux/capture <port> <out.png>` screenshots its windows.
