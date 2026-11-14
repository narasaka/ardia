import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import { Animated as WebAnimated } from "react-native-web";

export * from "react-native-web";
export { MacPressable as Pressable, MacView as View } from "./view";
export { MacText as Text } from "./text";
export { TextInput } from "./textInput";

export const unstable_batchedUpdates = batchedUpdates;

class JsDrivenValue extends WebAnimated.Value {
  constructor(value: number, config?: { useNativeDriver?: boolean }) {
    super(value, config ? { ...config, useNativeDriver: false } : undefined);
  }
}

type Driven = { useNativeDriver?: boolean };
const jsDriven = <C extends Driven | undefined>(config: C): C => (config ? { ...config, useNativeDriver: false } : config);

export const Animated = {
  ...WebAnimated,
  Value: JsDrivenValue,
  timing: (value: never, config: Driven) => WebAnimated.timing(value, jsDriven(config) as never),
  spring: (value: never, config: Driven) => WebAnimated.spring(value, jsDriven(config) as never),
  decay: (value: never, config: Driven) => WebAnimated.decay(value, jsDriven(config) as never),
  event: (mapping: never, config?: Driven) => WebAnimated.event(mapping, jsDriven(config) as never),
} as unknown as typeof WebAnimated;

export const findNodeHandle = (component: unknown) => (component && typeof (component as Node).nodeType === "number" ? component : null) as unknown as number | null;

export const TurboModuleRegistry = { get: () => null, getEnforcing: (name: string) => { throw new Error(`${name} is not a turbo module on Linux`); } };
