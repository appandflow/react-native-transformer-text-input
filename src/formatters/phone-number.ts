import { Transformer, type Selection } from '../Transformer';
import {
  COUNTRY_CALLING_CODES,
  COUNTRY_PHONE_DATA,
  type PhoneFormat,
} from './phone-data';

export type PhoneNumberTransformerOptions = {
  /**
   * ISO 3166-1 alpha-2 country code for phone number formatting.
   * @default 'US'
   */
  country?: string;
  /**
   * When false, the output only contains the formatted national number
   * (without the "+{callingCode} " prefix). Useful when the calling code
   * is displayed separately (e.g., in a flag button).
   * @default true
   */
  includeCallingCode?: boolean;
  /**
   * International mode: the calling code is part of the editable text and the
   * country is detected from it as you type (e.g. typing "+44" switches
   * formatting to the UK). `country` is ignored in this mode. Use
   * {@link detectCountry} to drive a flag/country indicator from the value.
   * @default false
   */
  international?: boolean;
  /**
   * Enable debug logging for transformer operations.
   * @default false
   */
  debug?: boolean;
};

// Longest calling-code prefix (1–3 digits) of `digits` that is a key of
// `codes`. `codes` can be any calling-code-keyed record (the lookup table or
// the per-code format index), so the worklet reuses its captured index.
const matchCallingCode = (
  digits: string,
  codes: Record<string, unknown>,
): string => {
  'worklet';
  const max = Math.min(3, digits.length);
  for (let len = max; len >= 1; len--) {
    if (codes[digits.slice(0, len)] !== undefined) {
      return digits.slice(0, len);
    }
  }
  return '';
};

/**
 * Detect the ISO 3166-1 alpha-2 country for a phone value by its leading
 * international calling code. Returns the primary country for the code (e.g.
 * "US" for "+1"), or undefined if no calling code is recognized yet. Runs on
 * the JS thread — use it to drive a flag/country indicator alongside an
 * `international` PhoneNumberTransformer.
 */
export function detectCountry(value: string): string | undefined {
  const digits = value.replace(/\D/g, '');
  const code = matchCallingCode(digits, COUNTRY_CALLING_CODES);
  return code ? COUNTRY_CALLING_CODES[code]?.[0] : undefined;
}

// Extract all digits from text
const extractDigits = (text: string): string => {
  'worklet';
  return text.replace(/\D/g, '');
};

// Count digits before a position in text
const countDigitsBefore = (text: string, pos: number): number => {
  'worklet';
  let count = 0;
  for (let i = 0; i < Math.min(pos, text.length); i++) {
    const char = text[i];
    if (char !== undefined && char >= '0' && char <= '9') {
      count++;
    }
  }
  return count;
};

// Count the max digits the format pattern can consume by counting \d occurrences
// in the capture groups.
const getFormatMaxDigits = (pattern: string): number => {
  'worklet';
  let count = 0;
  // Each \\d or \d in the pattern represents one digit slot.
  // But patterns use quantifiers like {3} or {3,4} — we want the max.
  // Simple approach: count the max digits by examining the pattern groups.
  // Groups look like (\d{3}) or (\d{2,4}) or (\d{3,12})
  // We'll parse {n} and {n,m} to get max values.
  let i = 0;
  while (i < pattern.length) {
    if (
      pattern[i] === '\\' &&
      i + 1 < pattern.length &&
      pattern[i + 1] === 'd'
    ) {
      i += 2;
      if (i < pattern.length && pattern[i] === '{') {
        // Parse {n} or {n,m}
        const closeBrace = pattern.indexOf('}', i);
        if (closeBrace !== -1) {
          const inner = pattern.slice(i + 1, closeBrace);
          const commaIdx = inner.indexOf(',');
          if (commaIdx !== -1) {
            // {n,m} — use max
            count += parseInt(inner.slice(commaIdx + 1), 10) || 0;
          } else {
            count += parseInt(inner, 10) || 0;
          }
          i = closeBrace + 1;
        }
      } else {
        // Just \d without quantifier — 1 digit
        count += 1;
      }
    } else {
      i++;
    }
  }
  return count;
};

// Select the best format for a given national number based on leading digits.
// Iterates formats and tests the leadingDigits regex against the start of digits.
// A format whose pattern can't hold every digit typed so far is passed over for
// the next match, so a short format that shares a prefix with a longer one
// (NANP lists the 7-digit "310-XXXX" service numbers ahead of the 10-digit
// "(310) XXX-XXXX") never truncates the longer number. Returns the first match
// that fits, else the widest match, else the last format as fallback.
const selectFormat = (
  nationalDigits: string,
  formats: PhoneFormat[],
): PhoneFormat | null => {
  'worklet';
  if (formats.length === 0) return null;
  if (nationalDigits.length === 0) return formats[formats.length - 1]!;

  let widest: PhoneFormat | null = null;
  let widestMax = -1;
  for (const format of formats) {
    // Test leading digits regex against the national digits.
    // The regex should match from the start of the digits.
    if (format.leadingDigits) {
      const re = new RegExp('^(?:' + format.leadingDigits + ')');
      if (!re.test(nationalDigits)) continue;
    }
    const maxDigits = getFormatMaxDigits(format.pattern);
    if (nationalDigits.length <= maxDigits) {
      return format;
    }
    if (maxDigits > widestMax) {
      widest = format;
      widestMax = maxDigits;
    }
  }

  // Every matching format overflowed: the widest one clamps the input.
  return widest !== null ? widest : formats[formats.length - 1]!;
};

// Build a partial format for when we don't have enough digits to match the full pattern.
// We expand digit groups one at a time and fill what we can.
const buildPartialFormat = (digits: string, format: PhoneFormat): string => {
  'worklet';
  // Parse the pattern to extract groups
  // Pattern like (\d{3})(\d{3})(\d{4}) with template ($1) $2-$3
  // We need to figure out group sizes and fill them progressively

  const groups: number[] = [];
  let i = 0;
  const pattern = format.pattern;

  while (i < pattern.length) {
    if (pattern[i] === '(' && i + 1 < pattern.length) {
      // Find matching close paren
      let depth = 1;
      let j = i + 1;
      while (j < pattern.length && depth > 0) {
        if (pattern[j] === '(') depth++;
        else if (pattern[j] === ')') depth--;
        j++;
      }
      // Extract group content
      const groupContent = pattern.slice(i + 1, j - 1);
      // Count max digits in this group
      const groupMax = getFormatMaxDigits(groupContent);
      if (groupMax > 0) {
        groups.push(groupMax);
      }
      i = j;
    } else {
      i++;
    }
  }

  if (groups.length === 0) return digits;

  // Build the result by walking the template and replacing placeholders.
  // We track which groups got filled and which didn't.
  let digitIdx = 0;
  let result = '';
  let lastGroupComplete = false;
  let allGroupsFilled = true;

  // Walk through the template character by character
  let ti = 0;
  while (ti < format.template.length) {
    const tc = format.template[ti];
    if (tc === '$' && ti + 1 < format.template.length) {
      const groupNum = parseInt(format.template[ti + 1]!, 10);
      if (!isNaN(groupNum) && groupNum >= 1 && groupNum <= groups.length) {
        const groupSize = groups[groupNum - 1]!;
        const available = digits.length - digitIdx;
        if (available <= 0) {
          allGroupsFilled = false;
          break;
        }
        const chunk = digits.slice(digitIdx, digitIdx + groupSize);
        digitIdx += chunk.length;
        result += chunk;
        lastGroupComplete = chunk.length === groupSize;
        if (chunk.length < groupSize) {
          allGroupsFilled = false;
          break;
        }
        ti += 2;
        continue;
      }
    }
    // Literal character — only include if we haven't run out of digits
    result += tc;
    ti++;
  }

  if (allGroupsFilled) {
    return result;
  }

  // Handle trailing: if last group was fully filled, keep trailing separators
  // (like "555" → "(555) " with template "($1) $2-$3")
  // If last group was NOT fully filled, strip trailing non-digit chars
  if (lastGroupComplete) {
    // Keep trailing separators up to the next placeholder
    return result;
  }

  // Strip trailing non-digit chars for incomplete groups
  return result.replace(/[^\d]+$/, '');
};

// Apply a format to national digits. Returns the formatted national number.
const applyFormat = (nationalDigits: string, format: PhoneFormat): string => {
  'worklet';
  const re = new RegExp(format.pattern);
  const maxDigits = getFormatMaxDigits(format.pattern);
  const clamped = nationalDigits.slice(0, maxDigits);

  // Only apply template if we have enough digits for at least the first group
  const match = clamped.match(re);
  if (match) {
    return clamped.replace(re, format.template);
  }

  // Partial input — build a partial format by expanding the pattern groups progressively.
  return buildPartialFormat(clamped, format);
};

// Map cursor position from digit-space to formatted-space.
// Given a count of digits the cursor is after, find the position
// in the formatted string after that many digits.
const mapCursorToFormatted = (
  formatted: string,
  digitCount: number,
): number => {
  'worklet';
  if (digitCount <= 0) {
    // Find position of first digit in formatted string
    for (let i = 0; i < formatted.length; i++) {
      const c = formatted[i];
      if (c !== undefined && c >= '0' && c <= '9') {
        return i;
      }
    }
    return 0;
  }

  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted[i];
    if (c !== undefined && c >= '0' && c <= '9') {
      count++;
      if (count === digitCount) {
        return i + 1;
      }
    }
  }
  return formatted.length;
};

export class PhoneNumberTransformer extends Transformer {
  constructor({
    country = 'US',
    includeCallingCode = true,
    international = false,
    debug = false,
  }: PhoneNumberTransformerOptions = {}) {
    if (international) {
      // Per-calling-code formatting data (primary country for each code),
      // captured once so the worklet can detect + format any country.
      const callingCodeData: Record<
        string,
        { formats: PhoneFormat[]; nationalPrefix: string }
      > = {};
      for (const code in COUNTRY_CALLING_CODES) {
        const primary = COUNTRY_CALLING_CODES[code]![0]!;
        const d = COUNTRY_PHONE_DATA[primary];
        if (d) {
          callingCodeData[code] = {
            formats: d.formats,
            nationalPrefix: d.nationalPrefix ?? '',
          };
        }
      }

      const intlWorklet = (input: {
        value: string;
        previousValue: string;
        selection: Selection;
        previousSelection: Selection;
      }) => {
        'worklet';

        const { value, selection, previousValue, previousSelection } = input;

        const allDigits = extractDigits(value);
        const prevAllDigits = extractDigits(previousValue);

        if (allDigits.length === 0) {
          return { value: '', selection: { start: 0, end: 0 } };
        }

        const digitsBeforeStart = countDigitsBefore(value, selection.start);
        const digitsBeforeEnd = countDigitsBefore(value, selection.end);

        // Backspacing a separator removes the digit before the caret instead,
        // so deletion makes progress.
        const isCaret = selection.start === selection.end;
        const deletedFormattingChar =
          isCaret &&
          value.length < previousValue.length &&
          allDigits.length === prevAllDigits.length &&
          allDigits.length > 0;

        let workingDigits = allDigits;
        let finalStart = digitsBeforeStart;
        let finalEnd = digitsBeforeEnd;
        if (deletedFormattingChar && digitsBeforeStart > 0) {
          workingDigits =
            allDigits.slice(0, digitsBeforeStart - 1) +
            allDigits.slice(digitsBeforeStart);
          finalStart = digitsBeforeStart - 1;
          finalEnd = finalStart;
        }

        const cursorAtEnd =
          isCaret &&
          selection.end >= value.length &&
          previousSelection.end >= previousValue.length;

        const callingCode = matchCallingCode(workingDigits, callingCodeData);

        // No recognized calling code yet — show "+digits" as typed.
        if (callingCode === '') {
          const result = '+' + workingDigits;
          if (cursorAtEnd) {
            return {
              value: result,
              selection: { start: result.length, end: result.length },
            };
          }
          // One leading "+" before the digits.
          return {
            value: result,
            selection: { start: 1 + finalStart, end: 1 + finalEnd },
          };
        }

        const data = callingCodeData[callingCode]!;
        const nationalPrefix = data.nationalPrefix;
        const nationalDigits = workingDigits.slice(callingCode.length);

        let result: string;
        if (nationalDigits.length === 0) {
          result = '+' + callingCode;
        } else {
          let significantDigits = nationalDigits;
          let trunkPrefix = '';
          if (
            nationalPrefix.length > 0 &&
            nationalDigits.length > nationalPrefix.length &&
            nationalDigits.startsWith(nationalPrefix)
          ) {
            significantDigits = nationalDigits.slice(nationalPrefix.length);
            trunkPrefix = nationalPrefix;
          }
          const format = selectFormat(significantDigits, data.formats);
          const formattedNational = format
            ? trunkPrefix + applyFormat(significantDigits, format)
            : nationalDigits;
          result = '+' + callingCode + ' ' + formattedNational;
        }

        if (cursorAtEnd) {
          return {
            value: result,
            selection: { start: result.length, end: result.length },
          };
        }

        // result digits are [callingCode..., national...] in input order, so
        // map the input digit counts straight onto the formatted output.
        const newStart = mapCursorToFormatted(result, finalStart);
        const newEnd = mapCursorToFormatted(result, finalEnd);
        return { value: result, selection: { start: newStart, end: newEnd } };
      };

      super(intlWorklet);
      return;
    }

    const countryData = COUNTRY_PHONE_DATA[country];
    if (!countryData) {
      throw new Error(
        `[PhoneNumberTransformer] Country "${country}" is not supported.`,
      );
    }

    const callingCode = countryData.callingCode;
    const formats = countryData.formats;
    const nationalPrefix = countryData.nationalPrefix ?? '';
    const nationalPrefixLen = nationalPrefix.length;
    const prefix = '+' + callingCode + ' ';
    // Pre-compute these outside the worklet so only simple string/number
    // values are captured in the closure (more reliable across worklet runtimes).
    const outputPrefix = includeCallingCode ? prefix : '';
    const outputPrefixLen = outputPrefix.length;
    const codeToStrip = includeCallingCode ? callingCode : '';

    const worklet = (input: {
      value: string;
      previousValue: string;
      selection: Selection;
      previousSelection: Selection;
    }) => {
      'worklet';

      const { value, selection, previousValue, previousSelection } = input;

      // Extract digits
      const allDigits = extractDigits(value);
      const prevAllDigits = extractDigits(previousValue);

      // Handle completely empty
      if (allDigits.length === 0) {
        return { value: '', selection: { start: 0, end: 0 } };
      }

      let nationalDigits: string;
      let prevNationalDigits: string;
      let strippedCallingCode = false;

      if (codeToStrip.length > 0) {
        // Strip calling code from front to get national digits
        if (allDigits.startsWith(codeToStrip)) {
          nationalDigits = allDigits.slice(codeToStrip.length);
          strippedCallingCode = true;
        } else {
          nationalDigits = allDigits;
        }

        if (prevAllDigits.startsWith(codeToStrip)) {
          prevNationalDigits = prevAllDigits.slice(codeToStrip.length);
        } else {
          prevNationalDigits = prevAllDigits;
        }

        // Special case: only calling code digits remain
        if (nationalDigits.length === 0 && strippedCallingCode) {
          if (value.length < previousValue.length) {
            // Deleting — clear everything
            return { value: '', selection: { start: 0, end: 0 } };
          }
          // Show prefix
          return {
            value: outputPrefix,
            selection: { start: outputPrefixLen, end: outputPrefixLen },
          };
        }
      } else {
        // National-only mode: all digits are national, no calling code handling
        nationalDigits = allDigits;
        prevNationalDigits = prevAllDigits;
      }

      // Calculate digit positions for cursor mapping
      const digitsBeforeStart = countDigitsBefore(value, selection.start);
      const digitsBeforeEnd = countDigitsBefore(value, selection.end);
      const callingCodeLen = strippedCallingCode ? codeToStrip.length : 0;
      const adjustedStart = Math.max(0, digitsBeforeStart - callingCodeLen);
      const adjustedEnd = Math.max(0, digitsBeforeEnd - callingCodeLen);

      // Detect formatting char deletion
      const isCaret = selection.start === selection.end;
      const deletedFormattingChar =
        isCaret &&
        value.length < previousValue.length &&
        nationalDigits.length === prevNationalDigits.length &&
        nationalDigits.length > 0;

      let finalStart = adjustedStart;
      let finalEnd = adjustedEnd;
      if (deletedFormattingChar && adjustedStart > 0) {
        nationalDigits =
          nationalDigits.slice(0, adjustedStart - 1) +
          nationalDigits.slice(adjustedStart);
        finalStart = adjustedStart - 1;
        finalEnd = adjustedStart - 1;
      }

      // Strip the national trunk prefix (e.g. "0") before selecting and applying
      // a format — formats describe the national significant number — then
      // re-add it so the displayed digits still line up with the input.
      let significantDigits = nationalDigits;
      let trunkPrefix = '';
      if (
        nationalPrefixLen > 0 &&
        nationalDigits.length > nationalPrefixLen &&
        nationalDigits.startsWith(nationalPrefix)
      ) {
        significantDigits = nationalDigits.slice(nationalPrefixLen);
        trunkPrefix = nationalPrefix;
      }

      // Select format based on leading digits
      const format = selectFormat(significantDigits, formats);
      if (!format) {
        // No format available — just show digits
        const result = outputPrefix + nationalDigits;
        const pos = outputPrefixLen + finalStart;
        return { value: result, selection: { start: pos, end: pos } };
      }

      // Apply the selected format
      const formatted = trunkPrefix + applyFormat(significantDigits, format);
      const result = outputPrefix + formatted;

      // Map cursor position
      const cursorAtEnd = selection.end >= value.length;
      const prevCursorAtEnd = previousSelection.end >= previousValue.length;

      if (debug) {
        console.log('[PhoneNumberTransformer]', {
          input: { value, selection },
          nationalDigits,
          format: format.template,
          formatted,
          result,
          cursor: {
            finalStart,
            finalEnd,
            deletedFormattingChar,
          },
        });
      }

      // Cursor at end — put at end
      if (isCaret && cursorAtEnd && prevCursorAtEnd) {
        return {
          value: result,
          selection: { start: result.length, end: result.length },
        };
      }

      // Map cursor through the formatted output
      // We need to find where digit N is in the formatted result
      const newStart =
        outputPrefixLen + mapCursorToFormatted(formatted, finalStart);
      const newEnd =
        outputPrefixLen + mapCursorToFormatted(formatted, finalEnd);

      return {
        value: result,
        selection: { start: newStart, end: newEnd },
      };
    };

    super(worklet);
  }
}
