import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const project = readFileSync(`${repo}apps/browser/macos/Ardia.xcodeproj/project.pbxproj`, "utf8");
const nativeApi = readFileSync(`${repo}apps/browser/src/platform/nativeApi.ts`, "utf8");

const first = (pattern, text, fallback) => pattern.exec(text)?.[1] ?? fallback;

export const appVersion = process.env.ARDIA_VERSION || first(/MARKETING_VERSION = ([^;\s]+);/, project, "0.0.0");
export const appBuild = process.env.ARDIA_BUILD || first(/CURRENT_PROJECT_VERSION = (\d+);/, project, "0");
export const nativeApiVersion = Number(first(/NATIVE_API_VERSION = (\d+);/, nativeApi, "0"));

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ appVersion, appBuild, nativeApiVersion }));
