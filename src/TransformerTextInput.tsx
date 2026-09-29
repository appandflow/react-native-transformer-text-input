import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ElementRef,
  type Ref,
} from 'react';
import { StyleSheet, TextInput, type HostInstance } from 'react-native';
import { type Selection } from './Transformer';
import TransformerTextInputDecoratorViewNativeComponent, {
  Commands,
} from './TransformerTextInputDecoratorViewNativeComponent';
import { registerTransformer, unregisterTransformer } from './registry';
import useMergeRefs from './utils/useMergeRefs';
import { validateSelection } from './selection';
import {
  type TransformerTextInputInstance,
  type TransformerTextInputInstanceMethods,
  type TransformerTextInputProps,
} from './TransformerTextInput.types';

export type {
  TransformerTextInputInstance,
  TransformerTextInputProps,
} from './TransformerTextInput.types';

export const TransformerTextInput = forwardRef(
  (
    {
      transformer,
      onChangeText,
      defaultValue,
      ...others
    }: TransformerTextInputProps,
    forwardedRef: Ref<TransformerTextInputInstance>,
  ) => {
    const transformerId = useMemo(() => {
      return registerTransformer(transformer);
    }, [transformer]);

    // Pre-transform defaultValue on the JS thread so Yoga measures the correct
    // text from the start. Without this the native-side transformation happens
    // after layout and doesn't trigger a remeasure.
    const transformedDefaultValue = useMemo(() => {
      if (defaultValue == null) {
        return undefined;
      }
      const result = transformer.worklet({
        value: defaultValue,
        previousValue: defaultValue,
        selection: { start: defaultValue.length, end: defaultValue.length },
        previousSelection: { start: 0, end: 0 },
      });
      return result?.value ?? defaultValue;
    }, [defaultValue, transformer]);

    useEffect(() => {
      return () => {
        unregisterTransformer(transformerId);
      };
    }, [transformerId]);

    const decoratorRef =
      useRef<
        ElementRef<typeof TransformerTextInputDecoratorViewNativeComponent>
      >(null);
    const textRef = useRef(transformedDefaultValue ?? '');

    const setInputRef = useCallback((instance: HostInstance | null) => {
      if (instance != null) {
        Object.assign(instance, {
          getValue() {
            return textRef.current;
          },
          update({ value, selection, transform }) {
            const nativeRef = decoratorRef.current;
            if (!nativeRef) {
              return;
            }
            let newSelection: Selection;
            const newValue = value ?? textRef.current;
            if (selection != null) {
              validateSelection(selection, newValue.length);
              newSelection = selection;
            } else {
              // When changing value without selection, move cursor to end.
              newSelection = { start: newValue.length, end: newValue.length };
            }
            Commands.update(
              nativeRef,
              transform ?? true,
              value ?? null,
              newSelection.start,
              newSelection.end,
            );
          },
          clear() {
            this.update({ value: '', transform: false });
          },
        } satisfies TransformerTextInputInstanceMethods);
      }
    }, []);

    const inputRef = useMergeRefs(setInputRef, forwardedRef);

    const handleChangeText = useCallback(
      (text: string) => {
        textRef.current = text;
        onChangeText?.(text);
      },
      [onChangeText],
    );

    return (
      <TransformerTextInputDecoratorViewNativeComponent
        ref={decoratorRef}
        style={styles.decorator}
        transformerId={transformerId}
      >
        <TextInput
          // @ts-expect-error
          ref={inputRef}
          onChangeText={handleChangeText}
          defaultValue={transformedDefaultValue}
          {...others}
        />
      </TransformerTextInputDecoratorViewNativeComponent>
    );
  },
);

const styles = StyleSheet.create({
  decorator: { display: 'contents' },
});
