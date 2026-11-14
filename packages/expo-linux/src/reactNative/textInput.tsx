import { forwardRef, useCallback, useRef, type ComponentProps, type ComponentType, type ForwardedRef, type KeyboardEvent } from "react";
import { TextInput as WebTextInput } from "react-native-web";

type KeyMatch = { key: string; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean };
type Selection = { start: number; end: number };

export const NATIVE_CHANGE = Symbol("ardiaNativeChange");

export type NativeChangeField = HTMLInputElement & { [NATIVE_CHANGE]?: (text: string, selection: Selection) => void };

type MacTextInputProps = ComponentProps<typeof WebTextInput> & {
  keyDownEvents?: KeyMatch[];
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

const SHRINKS_LIKE_NATIVE = { minWidth: 0 };

const MODIFIERS = ["metaKey", "shiftKey", "altKey", "ctrlKey"] as const;
const matches = (e: KeyboardEvent, wanted: KeyMatch) => e.key === wanted.key && MODIFIERS.every((m) => wanted[m] === undefined || !!e[m] === wanted[m]);

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export const TextInput = forwardRef<unknown, MacTextInputProps>(function MacTextInput({ keyDownEvents, onKeyDown, ...props }, ref) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!keyDownEvents) return onKeyDown?.(e);
    if (!keyDownEvents.some((wanted) => matches(e, wanted))) return;
    e.preventDefault();
    onKeyDown?.(e);
  };
  const native = useRef({ changeText: props.onChangeText, selectionChange: props.onSelectionChange });
  native.current = { changeText: props.onChangeText, selectionChange: props.onSelectionChange };
  const attach = useCallback(
    (node: NativeChangeField | null) => {
      if (node)
        Object.assign(node, {
          setSelection: (start: number, end: number) => node.setSelectionRange(start, end),
          [NATIVE_CHANGE]: (text: string, selection: Selection) => {
            native.current.changeText?.(text);
            native.current.selectionChange?.({ nativeEvent: { selection } } as never);
          },
        });
      assignRef(ref, node);
    },
    [ref],
  );
  const Input = WebTextInput as unknown as ComponentType<Record<string, unknown>>;
  const onChange = (e: { target: EventTarget | null }) => {
    const field = e.target as HTMLInputElement | null;
    if (field && props.onSelectionChange) props.onSelectionChange({ nativeEvent: { selection: { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 } } } as never);
    (props.onChange as ((event: unknown) => void) | undefined)?.(e);
  };
  return <Input {...props} style={[SHRINKS_LIKE_NATIVE, props.style]} ref={attach} onChange={onChange} onKeyPress={onKeyDown || keyDownEvents ? handleKeyDown : props.onKeyPress} />;
}) as unknown as typeof WebTextInput;
