import { act, render } from '@testing-library/react-native';
import React from 'react';
import { TextInput } from 'react-native';
import { Transformer } from '../Transformer';
import {
  TransformerTextInput,
  type TransformerTextInputInstance,
} from '../TransformerTextInput.web';

jest.mock('react-native-worklets');
jest.mock('../NativeTransformerTextInputModule');

describe('TransformerTextInput web', () => {
  it('uses a cursor-only movement as the previous selection', () => {
    const calls: Array<{
      previousSelection: { start: number; end: number };
    }> = [];
    const transformer = new Transformer((input) => {
      'worklet';
      calls.push({ previousSelection: input.previousSelection });
      return { value: input.value, selection: input.selection };
    });
    const node = {
      value: '12.34',
      selectionStart: 2,
      selectionEnd: 2,
      setSelectionRange: jest.fn(),
    };
    const inputRef = React.createRef<TransformerTextInputInstance>();
    const onSelectionChange = jest.fn();

    const { UNSAFE_getByType } = render(
      <TransformerTextInput
        ref={inputRef}
        transformer={transformer}
        defaultValue="12.34"
        onSelectionChange={onSelectionChange}
      />,
      { createNodeMock: () => node },
    );
    const textInput = UNSAFE_getByType(TextInput);
    const input = inputRef.current;
    if (input == null) {
      throw new Error('Expected TextInput ref to be set');
    }
    Object.assign(input, node);

    act(() => {
      textInput.props.onSelectionChange({
        nativeEvent: { selection: { start: 2, end: 2 } },
      });
    });
    Object.assign(input, {
      value: '125.34',
      selectionStart: 3,
      selectionEnd: 3,
    });
    act(() => {
      textInput.props.onChangeText('125.34');
    });

    expect(calls.at(-1)?.previousSelection).toEqual({ start: 2, end: 2 });
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });
});
