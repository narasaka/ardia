import type { Session } from "electron";
import { onProfileSession } from "./guests";

type BeforeRequest = (details: Electron.OnBeforeRequestListenerDetails) => Electron.CallbackResponse | null;
type HeadersReceived = (details: Electron.OnHeadersReceivedListenerDetails) => Electron.HeadersReceivedResponse | null;

const beforeRequest: BeforeRequest[] = [];
const headersReceived: HeadersReceived[] = [];
const installed = new WeakSet<Session>();

export function onBeforeRequest(handler: BeforeRequest): void {
  beforeRequest.push(handler);
}

export function onHeadersReceived(handler: HeadersReceived): void {
  headersReceived.push(handler);
}

function firstAnswer<Details, Answer>(handlers: ((details: Details) => Answer | null)[], details: Details): Answer | null {
  for (const handler of handlers) {
    try {
      const answer = handler(details);
      if (answer) return answer;
    } catch (error) {
      console.warn("[ardia requests] a request filter failed", error);
    }
  }
  return null;
}

export function installRequestPipeline(session: Session): void {
  if (installed.has(session)) return;
  installed.add(session);
  session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => callback(firstAnswer(beforeRequest, details) ?? {}));
  session.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => callback(firstAnswer(headersReceived, details) ?? {}));
}

onProfileSession((session) => installRequestPipeline(session));
