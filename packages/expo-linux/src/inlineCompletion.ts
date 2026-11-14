import type { InlineCompletionNative, InlineWrite } from "@ardia/shell";
import { unstable_batchedUpdates } from "react-dom";
import { NATIVE_CHANGE, type NativeChangeField } from "./reactNative/textInput";

const NOT_WRITTEN: InlineWrite = 0;
const SHOWN: InlineWrite = 1;
const STALE: InlineWrite = 2;

const isField = (value: unknown): value is NativeChangeField => !!value && (value as Node).nodeName === "INPUT";

export const linuxInlineCompletion: InlineCompletionNative = {
  async complete(tag, typed, completion) {
    const field = tag as unknown;
    if (!isField(field)) return NOT_WRITTEN;
    const view = field.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const valueSetter = view && Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) return NOT_WRITTEN;
    if (field.value !== typed || field.ownerDocument.activeElement !== field) return STALE;
    const full = typed + completion;
    valueSetter.call(field, full);
    field.setSelectionRange(typed.length, full.length);
    unstable_batchedUpdates(() => field[NATIVE_CHANGE]?.(full, { start: typed.length, end: full.length }));
    return SHOWN;
  },
};
