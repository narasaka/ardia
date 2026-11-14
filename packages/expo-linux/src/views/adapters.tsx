import { type ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { useAppDark } from "../appearance";
import { ContextMenuArea as WebContextMenuArea, Surface as WebSurface, type SurfaceProps } from "../web/chrome";
import { MouseArea as WebMouseArea, type MiddleClickEvent } from "../web/MouseArea";

type NativeSurfaceProps = Omit<SurfaceProps, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  surfaceShadowColor?: string;
  surfaceShadowOpacity?: number;
  surfaceShadowRadius?: number;
  surfaceShadowOffset?: [number, number];
};

export function Surface({ surfaceShadowColor, surfaceShadowOpacity, surfaceShadowRadius, surfaceShadowOffset, ...props }: NativeSurfaceProps) {
  return <WebSurface {...props} shadowColor={surfaceShadowColor} shadowOpacity={surfaceShadowOpacity} shadowRadius={surfaceShadowRadius} shadowOffset={surfaceShadowOffset} />;
}

export function ContextMenuArea({ onContextMenu, ...props }: ViewProps & { onContextMenu?: (event: { nativeEvent: Record<string, never> }) => void; captureDescendants?: boolean }) {
  return <WebContextMenuArea {...props} onContextMenu={onContextMenu && (() => onContextMenu({ nativeEvent: {} }))} />;
}

export function MouseArea({ onMiddleClick, ...props }: ViewProps & { path?: string | null; onMiddleClick?: (event: { nativeEvent: MiddleClickEvent }) => void }) {
  return <WebMouseArea {...props} onMiddleClick={onMiddleClick && ((nativeEvent) => onMiddleClick({ nativeEvent }))} />;
}

type BubbleMaterial = "popover" | "menu" | "hudWindow" | "sheet" | "toolTip";

const BUBBLE_FILL: Record<"light" | "dark", Record<BubbleMaterial, string>> = {
  light: { popover: "rgba(246,246,246,0.92)", menu: "rgba(246,246,246,0.92)", hudWindow: "rgba(40,40,40,0.88)", sheet: "rgba(250,250,250,0.96)", toolTip: "rgba(250,250,250,0.96)" },
  dark: { popover: "rgba(44,44,46,0.92)", menu: "rgba(44,44,46,0.92)", hudWindow: "rgba(30,30,30,0.88)", sheet: "rgba(38,38,40,0.96)", toolTip: "rgba(48,48,50,0.96)" },
};

type BubbleProps = ViewProps & {
  material?: BubbleMaterial;
  dark?: boolean;
  cornerRadius?: number;
  arrowEdge?: "top" | "bottom" | "none";
  arrowX?: number;
  arrowWidth?: number;
  arrowHeight?: number;
  tint?: string;
  edgeColor?: string;
  edgeWidth?: number;
  bubbleShadowOpacity?: number;
  bubbleShadowRadius?: number;
  bubbleShadowOffsetY?: number;
  glass?: boolean;
  children?: ReactNode;
};

export function PopoverBubble({ material = "popover", dark, cornerRadius = 10, arrowEdge = "none", arrowX = 0, arrowWidth = 0, arrowHeight = 0, tint, edgeColor, edgeWidth = 0, bubbleShadowOpacity = 0.2, bubbleShadowRadius = 12, bubbleShadowOffsetY = 4, glass: _glass, style, children, ...props }: BubbleProps) {
  const appDark = useAppDark();
  const tone = (dark ?? appDark) ? "dark" : "light";
  const fill = tint ?? BUBBLE_FILL[tone][material];
  const inset = arrowEdge === "top" ? { top: arrowHeight } : arrowEdge === "bottom" ? { bottom: arrowHeight } : {};
  const body: Record<string, unknown> = {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    ...inset,
    borderRadius: cornerRadius,
    backgroundColor: fill,
    backdropFilter: "blur(24px) saturate(180%)",
    boxShadow: `0px ${bubbleShadowOffsetY}px ${bubbleShadowRadius * 2}px rgba(0,0,0,${bubbleShadowOpacity})`,
    ...(edgeColor && edgeWidth > 0 ? { borderColor: edgeColor, borderWidth: edgeWidth, borderStyle: "solid" } : {}),
  };
  const arrow =
    arrowEdge !== "none" && arrowWidth > 0 && arrowHeight > 0 ? (
      <svg
        width={arrowWidth}
        height={arrowHeight}
        style={{ position: "absolute", left: arrowX - arrowWidth / 2, [arrowEdge === "top" ? "top" : "bottom"]: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <path d={arrowEdge === "top" ? `M0 ${arrowHeight} L${arrowWidth / 2} 0 L${arrowWidth} ${arrowHeight} Z` : `M0 0 L${arrowWidth / 2} ${arrowHeight} L${arrowWidth} 0 Z`} fill={fill} />
      </svg>
    ) : null;
  return (
    <View {...props} style={style}>
      <View pointerEvents="none" style={body as never} />
      {arrow}
      {children}
    </View>
  );
}
