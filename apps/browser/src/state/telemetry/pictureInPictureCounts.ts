import type { PageEngine } from "../engines/engines";

let nothingPlaying = 0;
const backToTab: Record<PageEngine, number> = { chromium: 0, webkit: 0 };
const clickSkips = { back: 0, ahead: 0 };

export function noteAutoPictureInPictureNothingPlaying() {
  nothingPlaying++;
}

export function notePictureInPictureBackToTab(engine: PageEngine) {
  backToTab[engine]++;
}

export function notePictureInPictureClickSkip(seconds: number) {
  if (seconds < 0) clickSkips.back++;
  else if (seconds > 0) clickSkips.ahead++;
}

export function takePictureInPictureCounts() {
  const taken = { nothingPlaying, backToTab: { ...backToTab }, clickSkips: { ...clickSkips } };
  nothingPlaying = 0;
  backToTab.chromium = 0;
  backToTab.webkit = 0;
  clickSkips.back = 0;
  clickSkips.ahead = 0;
  return taken;
}
