import { forwardRef, useCallback, useMemo, useRef, type Ref } from 'react';
import { TextInput } from 'react-native';
import { type Selection } from './Transformer';
import { computeUncontrolledSelection, validateSelection } from './selection';
import useMergeRefs from './utils/useMergeRefs';
import {
  type TransformerTextInputInstance,
  type TransformerTextInputInstanceMethods,
  type TransformerTextInputProps,
} from './TransformerTextInput.types';

export type {
  TransformerTextInputInstance,
  TransformerTextInputProps,
} from './TransformerTextInput.types';

// The web host node is a DOM input; type only the bits we use so the library's
// tsconfig doesn't need the `dom` lib.
type WebInputNode = {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange: (start: number, end: number) => void;
};

// Web implementation. There is no UI thread, so instead of the native decorator
// running the transformer worklet on the UI runtime, we run the same transformer
// synchronously in JS on every change. The input is uncontrolled: the formatted
// value and caret are written straight to the DOM node in the change handler
// (mirroring the native side's imperative update), so there's no React
// re-render and no intermediate paint where the caret jumps to the end. Web is
// single-threaded, so value and selection land together in one step.
export const TransformerTextInput = forwardRef(
  (
    {
      transformer,
      onChangeText,
      onSelectionChange,
      defaultValue,
      ...others
    }: TransformerTextInputProps,
    forwardedRef: Ref<TransformerTextInputInstance>,
  ) => {
    const transformedDefaultValue = useMemo(() => {
      if (defaultValue == null) {
        return '';
      }
      const result = transformer.worklet({
        value: defaultValue,
        previousValue: defaultValue,
        selection: { start: defaultValue.length, end: defaultValue.length },
        previousSelection: { start: 0, end: 0 },
      });
      return result?.value ?? defaultValue;
    }, [defaultValue, transformer]);

    const valueRef = useRef(transformedDefaultValue);
    const previousRef = useRef<{ value: string; selection: Selection }>({
      value: transformedDefaultValue,
      selection: {
        start: transformedDefaultValue.length,
        end: transformedDefaultValue.length,
      },
    });
    const nodeRef = useRef<WebInputNode | null>(null);

    const applyTransform = useCallback(
      (
        rawValue: string,
        rawSelection: Selection,
        transform: boolean,
      ): string => {
        const prev = previousRef.current;
        const result = transform
          ? transformer.worklet({
              value: rawValue,
              previousValue: prev.value,
              selection: rawSelection,
              previousSelection: prev.selection,
            })
          : null;
        const newValue = result?.value ?? rawValue;
        let newSelection: Selection;
        if (result?.selection != null) {
          newSelection = result.selection;
          validateSelection(newSelection, newValue.length);
        } else {
          newSelection = computeUncontrolledSelection(
            rawValue,
            newValue,
            rawSelection.start,
            rawSelection.end,
          );
        }
        previousRef.current = { value: newValue, selection: newSelection };
        valueRef.current = newValue;
        // Write straight to the DOM node — uncontrolled, no React re-render.
        const node = nodeRef.current;
        if (node != null) {
          node.value = newValue;
          if (typeof node.setSelectionRange === 'function') {
            node.setSelectionRange(newSelection.start, newSelection.end);
          }
        }
        return newValue;
      },
      [transformer],
    );

    const handleChangeText = useCallback(
      (text: string) => {
        // On web the DOM caret sits right after the edit when onChangeText
        // fires; read it so the transformer can map it like the native side.
        const node = nodeRef.current;
        const rawSelection: Selection =
          node != null && typeof node.selectionStart === 'number'
            ? {
                start: node.selectionStart,
                end: node.selectionEnd ?? node.selectionStart,
              }
            : { start: text.length, end: text.length };
        const newValue = applyTransform(text, rawSelection, true);
        onChangeText?.(newValue);
      },
      [applyTransform, onChangeText],
    );

    const handleSelectionChange = useCallback(
      (
        event: Parameters<
          NonNullable<TransformerTextInputProps['onSelectionChange']>
        >[0],
      ) => {
        const node = nodeRef.current;
        if (node == null || node.value === valueRef.current) {
          previousRef.current = {
            value: valueRef.current,
            selection: event.nativeEvent.selection,
          };
        }
        onSelectionChange?.(event);
      },
      [onSelectionChange],
    );

    const setInputRef = useCallback(
      (instance: TransformerTextInputInstance | null) => {
        nodeRef.current = instance as unknown as WebInputNode | null;
        if (instance != null) {
          Object.assign(instance, {
            getValue() {
              return valueRef.current;
            },
            update({ value: nextValue, selection, transform }) {
              const base = nextValue ?? valueRef.current;
              const sel = selection ?? { start: base.length, end: base.length };
              applyTransform(base, sel, transform ?? true);
            },
            clear() {
              this.update({ value: '', transform: false });
            },
          } satisfies TransformerTextInputInstanceMethods);
        }
      },
      [applyTransform],
    );

    const inputRef = useMergeRefs(setInputRef, forwardedRef);

    return (
      <TextInput
        // @ts-expect-error web host node carries the instance methods
        ref={inputRef}
        defaultValue={transformedDefaultValue}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        {...others}
      />
    );
  },
);
