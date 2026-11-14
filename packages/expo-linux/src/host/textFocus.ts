import { callMain } from "../bridge";

const TEXT_TYPES = new Set(["", "text", "search", "url", "email", "password", "tel", "number"]);

let reported: boolean | null = null;

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element.nodeName === "TEXTAREA") return true;
  if (element.nodeName === "INPUT") return TEXT_TYPES.has((element as HTMLInputElement).type);
  return (element as HTMLElement).isContentEditable === true;
}

function report() {
  const focused = isTextField(document.activeElement);
  if (focused === reported) return;
  reported = focused;
  void callMain("ArdiaFocus", "setTextInputFocused", focused).catch(() => {
    reported = null;
  });
}

export function installTextFocusReport() {
  document.addEventListener("focusin", () => queueMicrotask(report), true);
  document.addEventListener("focusout", () => setTimeout(report, 0), true);
  window.addEventListener("focus", () => queueMicrotask(report));
}
