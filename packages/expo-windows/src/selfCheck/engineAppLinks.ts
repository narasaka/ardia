import type { WindowsNative } from "@ardia/shell";
import { engineAvailable, hostCall, onEngineTopic } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type TabEvent = { key?: unknown; name?: unknown; data?: { title?: unknown; isLoading?: unknown; id?: unknown; origin?: unknown } };

const KEY = "self-check-app-link-document";
const WAIT_MS = 20000;
const pageTitled = (title: string) => `data:text/html,<title>${title}</title><p>an opaque-origin page</p>`;

const firstWindow = async () => {
  const ids = await requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows").windowIds();
  expectTrue(ids.length > 0, "no window is open to host a page");
  return ids[0]!;
};

const nextEvent = (match: (event: TabEvent) => boolean, what: string) =>
  new Promise<TabEvent>((resolve, reject) => {
    const watching = onEngineTopic("tab", (event: TabEvent) => {
      if (event.key !== KEY || !match(event)) return;
      clearTimeout(deadline);
      watching.remove();
      resolve(event);
    });
    const deadline = setTimeout(() => {
      watching.remove();
      reject(new Error(`no ${what} within ${WAIT_MS} ms`));
    }, WAIT_MS);
  });

const loaded = (title: string) => nextEvent((event) => event.name === "navigation" && event.data?.title === title && event.data.isLoading === false, `the page titled "${title}"`);

const withEngine: Check[] = [
  {
    name: "engine: an ask to open another app from a data: page stops counting once that page's document is gone",
    async run() {
      const windowId = await firstWindow();
      const first = loaded("asking document");
      await hostCall("tab.create", { key: KEY, url: pageTitled("asking document"), profile: "" }, windowId);
      try {
        await first;
        const asked = nextEvent((event) => event.name === "externalApp", "an externalApp ask");
        await hostCall("tab.call", { key: KEY, method: "executeJavaScript", code: 'location.href = "ardia-self-check-link:from-data"' });
        const ask = await asked;
        expectEqual(ask.data?.origin, null, "the origin a data: page's ask shows");
        const next = loaded("next document");
        await hostCall("tab.call", { key: KEY, method: "loadUrl", url: pageTitled("next document") });
        await next;
        const alive = await hostCall<{ alive?: unknown }>("tab.call", { key: KEY, method: "externalAppAlive", id: ask.data?.id });
        expectEqual(alive.alive, false, "the ask after its data: document was replaced");
      } finally {
        await hostCall("tab.close", { key: KEY });
      }
    },
  },
];

export const checks: Check[] = engineAvailable() ? withEngine : [];
