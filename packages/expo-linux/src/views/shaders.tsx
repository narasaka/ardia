import { useMemo, useState } from "react";
import { View, type ViewProps } from "react-native";
import { useAppDark } from "../appearance";
import { prefersReducedMotion } from "../web/gl/clock";
import { parseHex } from "../web/gl/colors";
import { BackdropFallback, HaloFallback, PowerUpFallback } from "../web/gl/fallbacks";
import { GLView } from "../web/gl/GLView";
import { backdropFragment, haloFragment, powerUpFragment } from "../web/gl/sources";
import { webgl2Supported } from "../web/gl/surface";
import { backdropUniforms, HALO, haloUniforms, POWER_UP, powerUpPalette, powerUpUniforms } from "../web/gl/uniforms";
import { Vibrancy } from "../web/gl/Vibrancy";

const FRAME = 1 / 60;

type BackdropProps = ViewProps & {
  colors: [string, string];
  vibrancy?: boolean;
  tintColor?: string;
  tintAlpha?: number;
  tintLightness?: number;
  angle?: number;
  grainOpacity?: number;
  grainScale?: number;
};

export function WindowBackdrop({ colors, angle = 180, grainOpacity = 0.09, grainScale = 1, vibrancy, tintColor, tintAlpha, tintLightness, style }: BackdropProps) {
  const dark = useAppDark();
  const key = `${colors.join()}|${angle}|${grainOpacity}|${grainScale}`;
  const uniformsAt = useMemo(() => (css: [number, number]) => backdropUniforms({ colors, angle, grainOpacity, grainScale }, css), [key]);
  return (
    <View pointerEvents="none" style={style}>
      {vibrancy ? (
        <Vibrancy dark={dark} tintColor={tintColor} tintAlpha={tintAlpha} tintLightness={tintLightness} />
      ) : webgl2Supported() ? (
        <GLView fragment={backdropFragment} uniformsAt={uniformsAt} version={key} />
      ) : (
        <BackdropFallback colors={colors} angle={angle} />
      )}
    </View>
  );
}

type PowerUpProps = ViewProps & { palette?: string[]; speed?: number; origin?: number; cornerRadius?: number; haloFrame?: number[] };

export function PowerUp({ palette = ["pink"], speed = POWER_UP.defaultSpeed, origin = POWER_UP.defaultOrigin, cornerRadius = POWER_UP.defaultCornerRadius, haloFrame, style }: PowerUpProps) {
  const dark = useAppDark();
  const [reduceMotion] = useState(prefersReducedMotion);
  const named = palette.length === 1 && !palette[0]!.startsWith("#") ? palette[0]! : palette;
  const paletteKey = palette.join();
  const srgb = useMemo(() => powerUpPalette(named as never), [paletteKey]);
  const powerUpAt = useMemo(() => (_css: [number, number], time: number) => powerUpUniforms({ srgb, speed, origin }, time), [srgb, speed, origin]);
  const haloAt = useMemo(() => (css: [number, number], time: number) => haloUniforms({ srgb, speed, cornerRadius, dark }, css, time), [srgb, speed, cornerRadius, dark]);
  if (reduceMotion) return <View pointerEvents="none" style={style} />;
  const gl = webgl2Supported();
  const [x = 0, y = 0, width = 0, height = 0] = haloFrame ?? [];
  const haloBox = width > 0 && height > 0 ? { left: x - HALO.inset, top: y - HALO.inset, width: width + 2 * HALO.inset, height: height + 2 * HALO.inset } : null;
  return (
    <View pointerEvents="none" style={style}>
      {gl ? (
        <GLView fragment={powerUpFragment} uniformsAt={powerUpAt} animation={{ lastFrameTime: POWER_UP.finishTime - FRAME }} style={{ filter: "blur(24px)" }} />
      ) : (
        <PowerUpFallback srgb={srgb} speed={speed} />
      )}
      {haloBox ? (
        <div style={{ position: "absolute", pointerEvents: "none", ...haloBox }}>
          {gl ? (
            <GLView fragment={haloFragment} uniformsAt={haloAt} animation={{ lastFrameTime: HALO.finishTime }} />
          ) : (
            <HaloFallback color={srgb[0] ?? parseHex("#FF845A")!} speed={speed} cornerRadius={cornerRadius + 2} dark={dark} />
          )}
        </div>
      ) : null}
    </View>
  );
}
