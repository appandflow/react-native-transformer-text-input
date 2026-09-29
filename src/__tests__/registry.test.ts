jest.mock('react-native-worklets');
jest.mock('../NativeTransformerTextInputModule');

const createWorklet =
  () =>
  ({
    value,
    selection,
  }: {
    value: string;
    selection: { start: number; end: number };
  }) => {
    'worklet';
    return { value, selection };
  };

describe('registry', () => {
  let Transformer: typeof import('../Transformer').Transformer;
  let registerTransformer: typeof import('../registry').registerTransformer;
  let unregisterTransformer: typeof import('../registry').unregisterTransformer;

  beforeEach(() => {
    jest.resetModules();
    delete globalThis.__rntti_registerTransformerRegistry;
    ({ Transformer } = require('../Transformer'));
    ({ registerTransformer, unregisterTransformer } = require('../registry'));
  });

  it('registers and unregisters transformers', () => {
    const transformer = new Transformer(createWorklet());
    const id = registerTransformer(transformer);
    const registry = globalThis.__rntti_registerTransformerRegistry;

    expect(registry?.get(id)).toBeDefined();
    unregisterTransformer(id);
    expect(registry?.get(id)).toBeUndefined();
  });

  it('allows null selection to pass through', () => {
    const transformer = new Transformer(({ value }: { value: string }) => {
      'worklet';
      return { value, selection: null };
    });

    const id = registerTransformer(transformer);
    const registry = globalThis.__rntti_registerTransformerRegistry;
    const wrapper = registry?.get(id);
    const result = wrapper?.('abc', 0, 0, true);

    expect(result?.selection).toEqual({ start: 0, end: 0 });
  });

  it('allows null value to pass through', () => {
    const transformer = new Transformer(() => {
      'worklet';
      return { value: null, selection: { start: 0, end: 0 } };
    });

    const id = registerTransformer(transformer);
    const registry = globalThis.__rntti_registerTransformerRegistry;
    const wrapper = registry?.get(id);
    const result = wrapper?.('abc', 0, 0, true);

    expect(result?.value).toEqual('abc');
  });

  it('allows null transformer result to pass through', () => {
    const transformer = new Transformer(() => {
      'worklet';
      return null;
    });

    const id = registerTransformer(transformer);
    const registry = globalThis.__rntti_registerTransformerRegistry;
    const wrapper = registry?.get(id);
    const result = wrapper?.('abc', 0, 0, true);

    expect(result?.value).toEqual('abc');
    expect(result?.selection).toEqual({ start: 0, end: 0 });
  });

  it('does not call transformer when transform is false', () => {
    let callCount = 0;
    const transformer = new Transformer(({ value }) => {
      'worklet';
      callCount++;
      return { value: value.toUpperCase(), selection: { start: 0, end: 0 } };
    });

    const id = registerTransformer(transformer);
    const registry = globalThis.__rntti_registerTransformerRegistry;
    const wrapper = registry?.get(id);

    const result = wrapper?.('abc', 1, 2, false);

    expect(callCount).toBe(0);
    expect(result?.value).toEqual('abc');
    expect(result?.selection).toEqual({ start: 1, end: 2 });
  });

  it('updates previous state when transform is false', () => {
    let receivedPreviousValue = '';
    let receivedPreviousSelection = { start: 0, end: 0 };
    const transformer = new Transformer(
      ({ value, previousValue, selection, previousSelection }) => {
        'worklet';
        receivedPreviousValue = previousValue;
        receivedPreviousSelection = previousSelection;
        return { value, selection };
      },
    );

    const id = registerTransformer(transformer);
    const wrapper = globalThis.__rntti_registerTransformerRegistry?.get(id);

    wrapper?.('12.34', 2, 2, false);
    wrapper?.('125.34', 3, 3, true);

    expect(receivedPreviousValue).toBe('12.34');
    expect(receivedPreviousSelection).toEqual({ start: 2, end: 2 });
  });
});
