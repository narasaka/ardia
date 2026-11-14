import { forwardRef, useCallback, useEffect, useRef, type ComponentType, type ForwardedRef } from "react";
import { View, type ViewProps } from "react-native";
import { callMain } from "../bridge";
import { windowIdOfNode } from "./appWindows";

type Props = ViewProps & {
  titleBarDoubleClick?: boolean;
  onRegionDoubleClick?: () => void;
  clickable?: boolean;
  onRegionClick?: () => void;
};

const MODULE = "ArdiaAppWindows";
const CLICK_SLOP = 4;
const INTERACTIVE = "input, textarea, select, button, a[href], webview, [contenteditable='true'], [role='button'], [role='link'], [tabindex]";

function assign<Value>(ref: ForwardedRef<Value>, value: Value | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

const pressedOnControl = (region: HTMLElement, target: EventTarget | null) => {
  const hit = target as Element | null;
  const control = hit?.closest?.(INTERACTIVE);
  return !!control && control !== region && region.contains(control);
};

export const WindowDragRegion = forwardRef<unknown, Props>(function WindowDragRegion({ titleBarDoubleClick = true, onRegionDoubleClick, clickable, onRegionClick, ...props }, ref) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef({ titleBarDoubleClick, onRegionDoubleClick, clickable, onRegionClick });
  latest.current = { titleBarDoubleClick, onRegionDoubleClick, clickable, onRegionClick };

  useEffect(() => {
    const region = node.current;
    if (!region) return;
    let pressed: { x: number; y: number; pointer: number } | null = null;
    let dragging = false;
    const windowId = () => windowIdOfNode(region);
    const stop = () => {
      if (dragging) void callMain(MODULE, "endWindowDrag");
      dragging = false;
      pressed = null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.detail > 1 || pressedOnControl(region, e.target)) return;
      pressed = { x: e.screenX, y: e.screenY, pointer: e.pointerId };
      dragging = false;
      region.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!pressed || dragging || e.pointerId !== pressed.pointer) return;
      if (Math.abs(e.screenX - pressed.x) < CLICK_SLOP && Math.abs(e.screenY - pressed.y) < CLICK_SLOP) return;
      dragging = true;
      void callMain(MODULE, "beginWindowDrag", windowId(), pressed.x, pressed.y);
    };
    const up = (e: PointerEvent) => {
      if (!pressed || e.pointerId !== pressed.pointer) return;
      const clicked = !dragging;
      stop();
      if (clicked && latest.current.clickable) latest.current.onRegionClick?.();
    };
    const double = (e: MouseEvent) => {
      if (e.button !== 0 || pressedOnControl(region, e.target)) return;
      stop();
      latest.current.onRegionDoubleClick?.();
      if (latest.current.titleBarDoubleClick) void callMain(MODULE, "toggleMaximizeWindow", windowId());
    };
    region.addEventListener("pointerdown", down);
    region.addEventListener("pointermove", move);
    region.addEventListener("pointerup", up);
    region.addEventListener("pointercancel", stop);
    region.addEventListener("lostpointercapture", stop);
    region.addEventListener("dblclick", double);
    return () => {
      stop();
      region.removeEventListener("pointerdown", down);
      region.removeEventListener("pointermove", move);
      region.removeEventListener("pointerup", up);
      region.removeEventListener("pointercancel", stop);
      region.removeEventListener("lostpointercapture", stop);
      region.removeEventListener("dblclick", double);
    };
  }, []);

  const attach = useCallback(
    (value: HTMLElement | null) => {
      node.current = value;
      assign(ref, value);
    },
    [ref],
  );
  const Region = View as unknown as ComponentType<Record<string, unknown>>;
  return <Region {...props} ref={attach} />;
});
