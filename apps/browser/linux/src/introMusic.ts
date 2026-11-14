import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { instanceFlag, launchConfig } from "./launch";
import { host } from "./windows";

const MUTE_FADE_SECONDS = 0.25;
const track = () => pathToFileURL(join(__dirname, "IntroMusic.wav")).href;

function inHost(code: string): Promise<unknown> {
  const window = host();
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  return window.webContents.executeJavaScript(code, true).catch(() => null);
}

const FADE = `window.__ardiaIntroFade = (target, seconds, stopAfter) => {
  const audio = window.__ardiaIntro;
  if (!audio) return;
  clearInterval(window.__ardiaIntroFadeTimer);
  const from = audio.volume;
  const steps = Math.max(1, Math.round(seconds * 60));
  let step = 0;
  window.__ardiaIntroFadeTimer = setInterval(() => {
    step++;
    audio.volume = Math.min(1, Math.max(0, from + (target - from) * (step / steps)));
    if (step < steps) return;
    clearInterval(window.__ardiaIntroFadeTimer);
    if (stopAfter) { audio.pause(); if (window.__ardiaIntro === audio) window.__ardiaIntro = null; }
  }, 1000 / 60);
};`;

export function playIntroMusic(muted: boolean): Promise<unknown> {
  const config = launchConfig();
  if (config.background && !instanceFlag("allowAudio")) return Promise.resolve(null);
  return inHost(`(() => {
    ${FADE}
    window.__ardiaIntro?.pause();
    const audio = new Audio(${JSON.stringify(track())});
    audio.volume = ${muted ? 0 : 1};
    audio.addEventListener("ended", () => { if (window.__ardiaIntro === audio) window.__ardiaIntro = null; });
    window.__ardiaIntro = audio;
    return audio.play().then(() => true, (error) => String(error));
  })()`);
}

export const setIntroMusicMuted = (muted: boolean) => inHost(`window.__ardiaIntroFade?.(${muted ? 0 : 1}, ${MUTE_FADE_SECONDS}, false)`);
export const stopIntroMusic = (fade: number) => inHost(`window.__ardiaIntroFade?.(0, ${Math.max(0, Number(fade) || 0)}, true)`);
