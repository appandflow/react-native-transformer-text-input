import { PhoneNumberTransformer, detectCountry } from '../phone-number';

// Helper to call the transformer worklet with simpler API
const transform = (
  transformer: PhoneNumberTransformer,
  value: string,
  selection: { start: number; end: number } = {
    start: value.length,
    end: value.length,
  },
  previousValue: string = '',
  previousSelection: { start: number; end: number } = { start: 0, end: 0 },
) => {
  return transformer.worklet({
    value,
    selection,
    previousValue,
    previousSelection,
  });
};

describe('PhoneNumberTransformer', () => {
  describe('constructor', () => {
    it('creates transformer with default options', () => {
      expect(() => new PhoneNumberTransformer()).not.toThrow();
    });

    it('creates transformer with US country', () => {
      expect(() => new PhoneNumberTransformer({ country: 'US' })).not.toThrow();
    });

    it('creates transformer with any valid country', () => {
      expect(() => new PhoneNumberTransformer({ country: 'CA' })).not.toThrow();
      expect(() => new PhoneNumberTransformer({ country: 'DE' })).not.toThrow();
      expect(() => new PhoneNumberTransformer({ country: 'GB' })).not.toThrow();
      expect(() => new PhoneNumberTransformer({ country: 'JP' })).not.toThrow();
    });

    it('throws for unsupported country', () => {
      expect(() => new PhoneNumberTransformer({ country: 'XX' })).toThrow(
        /Country "XX" is not supported/,
      );
    });
  });

  describe('formatting', () => {
    const transformer = new PhoneNumberTransformer();

    it('returns empty for empty input', () => {
      const result = transform(transformer, '');
      expect(result).toEqual({ value: '', selection: { start: 0, end: 0 } });
    });

    it('shows prefix when typing country code 1', () => {
      const result = transform(transformer, '1');
      expect(result?.value).toBe('+1 ');
      expect(result?.selection).toEqual({ start: 3, end: 3 });
    });

    it('formats partial area code', () => {
      const result = transform(transformer, '55');
      expect(result?.value).toBe('+1 (55');
    });

    it('formats complete area code', () => {
      const result = transform(transformer, '555');
      expect(result?.value).toBe('+1 (555) ');
    });

    it('formats area code complete', () => {
      const result = transform(transformer, '5551');
      expect(result?.value).toBe('+1 (555) 1');
    });

    it('formats area code and exchange', () => {
      const result = transform(transformer, '555123');
      expect(result?.value).toBe('+1 (555) 123-');
    });

    it('formats complete phone number', () => {
      const result = transform(transformer, '5551234567');
      expect(result?.value).toBe('+1 (555) 123-4567');
    });

    it('strips non-digit characters', () => {
      const result = transform(transformer, 'abc555def123ghi4567');
      expect(result?.value).toBe('+1 (555) 123-4567');
    });

    it('limits to 10 national digits', () => {
      const result = transform(transformer, '55512345678999');
      expect(result?.value).toBe('+1 (555) 123-4567');
    });
  });

  describe('cursor positioning', () => {
    const transformer = new PhoneNumberTransformer();

    it('positions cursor at end when typing at end', () => {
      const result = transform(
        transformer,
        '5551',
        { start: 4, end: 4 },
        '555',
        { start: 3, end: 3 },
      );
      expect(result?.value).toBe('+1 (555) 1');
      expect(result?.selection).toEqual({ start: 10, end: 10 });
    });

    it('positions cursor correctly after insertion in middle', () => {
      // Simulating inserting "9" after first digit in "555" -> "5955"
      const result = transform(
        transformer,
        '5955',
        { start: 2, end: 2 },
        '555',
        { start: 1, end: 1 },
      );
      expect(result?.value).toBe('+1 (595) 5');
      // Cursor should be after the 2nd national digit
      expect(result?.selection).toEqual({ start: 6, end: 6 });
    });

    it('positions cursor correctly after deletion', () => {
      // Simulating deleting "2" from "55512" -> "5551"
      const result = transform(
        transformer,
        '5551',
        { start: 4, end: 4 },
        '55512',
        { start: 5, end: 5 },
      );
      expect(result?.value).toBe('+1 (555) 1');
      expect(result?.selection).toEqual({ start: 10, end: 10 });
    });

    it('handles deletion in middle of number', () => {
      // Simulating deleting "5" from "5551" -> "551" with cursor at position 1
      const result = transform(
        transformer,
        '551',
        { start: 0, end: 0 },
        '5551',
        { start: 1, end: 1 },
      );
      expect(result?.value).toBe('+1 (551) ');
      // Cursor at first placeholder position (after "+1 (")
      expect(result?.selection).toEqual({ start: 4, end: 4 });
    });
  });

  describe('selection handling', () => {
    const transformer = new PhoneNumberTransformer();

    it('maintains selection range', () => {
      const result = transform(
        transformer,
        '5551234567',
        { start: 3, end: 7 },
        '5551234567',
        { start: 3, end: 7 },
      );
      expect(result?.value).toBe('+1 (555) 123-4567');
      // Selection should map to the same digits in formatted output
      expect(result?.selection?.start).toBeLessThan(
        result?.selection?.end ?? 0,
      );
    });

    it('handles selection at start', () => {
      const result = transform(
        transformer,
        '5551234567',
        { start: 0, end: 3 },
        '5551234567',
        { start: 0, end: 3 },
      );
      expect(result?.value).toBe('+1 (555) 123-4567');
      // Selection start at first placeholder (position 4), end after 3rd digit (position 7)
      expect(result?.selection).toEqual({ start: 4, end: 7 });
    });

    it('handles selection at end', () => {
      const result = transform(
        transformer,
        '5551234567',
        { start: 7, end: 10 },
        '5551234567',
        { start: 7, end: 10 },
      );
      expect(result?.value).toBe('+1 (555) 123-4567');
      // Selection maps digits 7-10 to formatted positions
      expect(result?.selection).toEqual({ start: 14, end: 17 });
    });
  });

  describe('Germany (DE)', () => {
    const transformer = new PhoneNumberTransformer({ country: 'DE' });

    it('formats Berlin number (2-digit area code)', () => {
      const result = transform(transformer, '301234567');
      expect(result?.value).toBe('+49 30 1234567');
    });

    it('formats Munich number (2-digit area code)', () => {
      const result = transform(transformer, '8912345678');
      expect(result?.value).toBe('+49 89 12345678');
    });

    it('formats mobile number (1511)', () => {
      const result = transform(transformer, '15112345678');
      expect(result?.value).toBe('+49 1511 2345678');
    });

    it('formats mobile number (170)', () => {
      const result = transform(transformer, '1701234567');
      expect(result?.value).toBe('+49 170 1234567');
    });

    it('formats partial Berlin number', () => {
      const result = transform(transformer, '30');
      // Group 1 complete (2 digits), shows trailing separator
      expect(result?.value).toBe('+49 30 ');
    });

    it('formats partial Berlin number with digits', () => {
      const result = transform(transformer, '3012');
      expect(result?.value).toBe('+49 30 12');
    });

    it('strips calling code 49 from input', () => {
      const result = transform(transformer, '49301234567');
      expect(result?.value).toBe('+49 30 1234567');
    });
  });

  describe('United Kingdom (GB)', () => {
    const transformer = new PhoneNumberTransformer({ country: 'GB' });

    it('formats London number', () => {
      const result = transform(transformer, '2012345678');
      expect(result?.value).toBe('+44 20 1234 5678');
    });

    it('formats mobile number', () => {
      const result = transform(transformer, '7911123456');
      expect(result?.value).toBe('+44 7911 123456');
    });
  });

  describe('Japan (JP)', () => {
    const transformer = new PhoneNumberTransformer({ country: 'JP' });

    it('formats Tokyo number', () => {
      const result = transform(transformer, '312345678');
      expect(result?.value).toBe('+81 3-1234-5678');
    });
  });

  describe('France (FR)', () => {
    const transformer = new PhoneNumberTransformer({ country: 'FR' });

    it('formats standard number', () => {
      const result = transform(transformer, '123456789');
      expect(result?.value).toBe('+33 1 23 45 67 89');
    });
  });

  describe('national trunk prefix', () => {
    const fr = new PhoneNumberTransformer({
      country: 'FR',
      includeCallingCode: false,
    });
    const gb = new PhoneNumberTransformer({
      country: 'GB',
      includeCallingCode: false,
    });
    const jp = new PhoneNumberTransformer({
      country: 'JP',
      includeCallingCode: false,
    });
    const au = new PhoneNumberTransformer({
      country: 'AU',
      includeCallingCode: false,
    });
    const us = new PhoneNumberTransformer({
      country: 'US',
      includeCallingCode: false,
    });

    it('formats a French mobile typed with the leading 0', () => {
      expect(transform(fr, '0612345678')?.value).toBe('06 12 34 56 78');
    });

    it('formats a French landline typed with the leading 0', () => {
      expect(transform(fr, '0123456789')?.value).toBe('01 23 45 67 89');
    });

    it('formats a UK mobile typed with the leading 0', () => {
      expect(transform(gb, '07911123456')?.value).toBe('07911 123456');
    });

    it('formats a UK London number typed with the leading 0', () => {
      expect(transform(gb, '02012345678')?.value).toBe('020 1234 5678');
    });

    it('formats a Japanese number typed with the leading 0', () => {
      expect(transform(jp, '0312345678')?.value).toBe('03-1234-5678');
    });

    it('formats an Australian mobile typed with the leading 0', () => {
      expect(transform(au, '0412345678')?.value).toBe('0412 345 678');
    });

    it('still formats the significant number when no trunk prefix is typed', () => {
      expect(transform(fr, '612345678')?.value).toBe('6 12 34 56 78');
    });

    it('does not treat a leading 1 as a trunk prefix for US', () => {
      expect(transform(us, '4155552671')?.value).toBe('(415) 555-2671');
    });
  });

  describe('country switching', () => {
    it('creates different transformers for different countries', () => {
      const us = new PhoneNumberTransformer({ country: 'US' });
      const de = new PhoneNumberTransformer({ country: 'DE' });

      const usResult = transform(us, '5551234567');
      const deResult = transform(de, '301234567');

      expect(usResult?.value).toBe('+1 (555) 123-4567');
      expect(deResult?.value).toBe('+49 30 1234567');
    });
  });

  describe('international mode', () => {
    const intl = new PhoneNumberTransformer({ international: true });

    it('formats a US number typed with +1', () => {
      expect(transform(intl, '+14155552671')?.value).toBe('+1 (415) 555-2671');
    });

    it('switches to French formatting when +33 is typed', () => {
      expect(transform(intl, '+33612345678')?.value).toBe('+33 6 12 34 56 78');
    });

    it('keeps a French trunk 0 when typed in full', () => {
      expect(transform(intl, '+330612345678')?.value).toBe(
        '+33 06 12 34 56 78',
      );
    });

    it('switches to UK formatting when +44 is typed', () => {
      expect(transform(intl, '+447911123456')?.value).toBe('+44 7911 123456');
    });

    it('shows just the calling code while it is the only thing typed', () => {
      expect(transform(intl, '+44')?.value).toBe('+44');
    });

    it('ignores the `country` option and follows the typed code', () => {
      const intlUs = new PhoneNumberTransformer({
        international: true,
        country: 'US',
      });
      expect(transform(intlUs, '+447911123456')?.value).toBe('+44 7911 123456');
    });
  });

  // NANP data lists Canada's 7-digit "310-XXXX" service-number format ahead of
  // the 10-digit format, so selecting a format by leading digits alone clamped
  // every +1 310 number to seven digits.
  describe('formats sharing a leading-digits prefix (NANP 310)', () => {
    const intl = new PhoneNumberTransformer({ international: true });

    it('formats a full 10-digit 310 number in international mode', () => {
      expect(transform(intl, '+13102705123')?.value).toBe('+1 (310) 270-5123');
    });

    it('formats a full 10-digit 310 number in national mode', () => {
      const us = new PhoneNumberTransformer({ country: 'US' });
      expect(transform(us, '3102705123')?.value).toBe('+1 (310) 270-5123');
    });

    it('still formats a 7-digit 310 service number', () => {
      const ca = new PhoneNumberTransformer({ country: 'CA' });
      expect(transform(ca, '3102705')?.value).toBe('+1 310-2705');
      expect(transform(intl, '+13102705')?.value).toBe('+1 310-2705');
    });

    it('switches from the 7-digit to the 10-digit format on the eighth digit', () => {
      expect(transform(intl, '+13102705')?.value).toBe('+1 310-2705');
      const result = transform(
        intl,
        '+1 310-27051',
        { start: 12, end: 12 },
        '+1 310-2705',
        { start: 11, end: 11 },
      );
      expect(result?.value).toBe('+1 (310) 270-51');
      expect(result?.selection).toEqual({ start: 15, end: 15 });
    });

    it('still limits a 310 number to 10 national digits', () => {
      expect(transform(intl, '+131027051234')?.value).toBe('+1 (310) 270-5123');
    });
  });

  describe('detectCountry', () => {
    it('resolves the primary country from the calling code', () => {
      expect(detectCountry('+1 415 555 2671')).toBe('US');
      expect(detectCountry('+44 7911 123456')).toBe('GB');
      expect(detectCountry('+33 6 12 34 56 78')).toBe('FR');
    });

    it('returns undefined when no calling code is recognized', () => {
      expect(detectCountry('')).toBeUndefined();
    });
  });
});
