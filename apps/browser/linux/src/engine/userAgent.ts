import { app } from "electron";

const platformToken = () => (process.arch === "arm64" ? "X11; Linux aarch64" : "X11; Linux x86_64");

export const chromeMajor = () => process.versions.chrome.split(".")[0];

export const chromeUserAgent = () => `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor()}.0.0.0 Safari/537.36`;

app.userAgentFallback = chromeUserAgent();
