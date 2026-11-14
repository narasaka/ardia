import { app, net } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineModule } from "../bridge";
import { APP_VERSION, RELEASES_PAGE, UPDATE_REPOSITORY } from "../build";
import { launchConfig } from "../launch";
import { note } from "../log";
import { dataDirectory } from "../paths";
import { confirmWithUser } from "./dialogs";
import { openExternal } from "./ardiaApp";
import { writeDocument } from "./documents";

type Channel = "stable" | "nightly";
type Preferences = { automaticChecks: boolean; lastCheck: number | null; channel: Channel | null; declined: string | null };
type Release = { tag_name: string; html_url: string; prerelease: boolean; draft: boolean; assets?: { name: string }[] };

const PREFERENCES = "linux-updates.json";
const FIRST_CHECK_AFTER_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const buildChannel = (): Channel => (/nightly/.test(APP_VERSION) ? "nightly" : "stable");

let preferencesRead: Preferences | null = null;
let checking = false;
let timer: NodeJS.Timeout | undefined;

function preferences(): Preferences {
  if (preferencesRead) return preferencesRead;
  const fresh: Preferences = { automaticChecks: true, lastCheck: null, channel: null, declined: null };
  try {
    Object.assign(fresh, JSON.parse(readFileSync(join(dataDirectory(), PREFERENCES), "utf8")));
  } catch {}
  return (preferencesRead = fresh);
}

function remember(patch: Partial<Preferences>): void {
  preferencesRead = { ...preferences(), ...patch };
  writeDocument(PREFERENCES, JSON.stringify(preferencesRead));
}

const channel = () => preferences().channel ?? buildChannel();

function versionParts(version: string): { numbers: number[]; nightly: number | null } {
  const [core = "", pre = ""] = version.replace(/^(linux-)?v/, "").split("-");
  const nightly = /nightly\.(\d+)/.exec(pre);
  return { numbers: core.split(".").map((part) => Number(part) || 0), nightly: nightly ? Number(nightly[1]) : pre ? 0 : null };
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (left.nightly === right.nightly) return 0;
  if (left.nightly === null) return 1;
  if (right.nightly === null) return -1;
  return Math.sign(left.nightly - right.nightly);
}

const hasLinuxBuild = (release: Release) => (release.assets ?? []).some((asset) => /\.(AppImage|deb)$/.test(asset.name));

async function newestRelease(): Promise<Release | null> {
  const response = await net.fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const releases = (await response.json()) as Release[];
  const wanted = releases.filter((release) => !release.draft && hasLinuxBuild(release) && (channel() === "nightly" || !release.prerelease));
  wanted.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return wanted[0] ?? null;
}

async function check(asked: boolean): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const release = await newestRelease();
    remember({ lastCheck: Date.now() });
    const version = release?.tag_name.replace(/^(linux-)?v/, "") ?? null;
    if (!release || !version || compareVersions(version, APP_VERSION) <= 0) {
      if (asked) await confirmWithUser({ title: "Ardia is up to date", message: `You have Ardia ${APP_VERSION}. Linux builds come from ${RELEASES_PAGE}.`, confirmTitle: "OK", cancelTitle: "" });
      return;
    }
    if (!asked && preferences().declined === version) return;
    const open = await confirmWithUser({
      title: "A newer Ardia is available",
      message: `Ardia ${version} is available. You have ${APP_VERSION}. Ardia on Linux doesn't update itself yet: download the AppImage or .deb from the release page.`,
      confirmTitle: "Open Release Page",
      cancelTitle: "Later",
    });
    if (open) await openExternal(release.html_url);
    else remember({ declined: version });
  } catch (error) {
    note("updater", `the update check failed: ${String(error)}`);
    if (asked) await confirmWithUser({ title: "Ardia couldn't check for updates", message: String(error instanceof Error ? error.message : error), confirmTitle: "OK", cancelTitle: "" });
  } finally {
    checking = false;
  }
}

const checksByItself = () => {
  const config = launchConfig();
  return app.isPackaged && preferences().automaticChecks && !config.background && !config.isolated;
};

function schedule(): void {
  clearInterval(timer);
  timer = undefined;
  if (!checksByItself()) return;
  timer = setInterval(() => void check(false), CHECK_EVERY_MS);
  setTimeout(() => void check(false), FIRST_CHECK_AFTER_MS);
}

app.whenReady().then(schedule);

defineModule("ArdiaUpdater", {
  async: {
    updaterState: async () => ({
      available: true,
      configured: app.isPackaged,
      automaticChecks: preferences().automaticChecks,
      automaticDownloads: false,
      canCheck: !checking,
      sessionInProgress: checking,
      feedURL: RELEASES_PAGE,
      lastCheck: preferences().lastCheck,
      version: APP_VERSION,
      displayVersion: APP_VERSION,
      channel: channel(),
      buildChannel: buildChannel(),
      switchCheck: null,
    }),
    checkForUpdates: async () => void check(true),
    setAutomaticUpdateChecks: async (on: boolean) => {
      remember({ automaticChecks: !!on });
      schedule();
    },
    setAutomaticUpdateDownloads: async () => {},
    setUpdateChannel: async (next: Channel) => remember({ channel: next === "nightly" ? "nightly" : "stable", declined: null }),
  },
});
