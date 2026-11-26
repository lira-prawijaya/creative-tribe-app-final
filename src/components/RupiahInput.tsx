import React, { useLayoutEffect, useRef } from 'react';
import { formatIDR } from '../utils/format';

interface RupiahInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'inputMode'
  > {
  /** Raw numeric string without thousand separators (e.g., "250000000" or "-500000") */
  value: string;
  /** Emits raw numeric string without separators (e.g., "250000000") */
  onValueChange: (rawNumericString: string) => void;
  allowNegative?: boolean;
}

export function formatRawNumericForDisplay(
  rawValue: string,
  allowNegative = false
): string {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return '';
  const isNeg = allowNegative && trimmed.startsWith('-');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return isNeg ? '-' : '';
  const num = Number(digits);
  if (!Number.isFinite(num)) return '';
  return `${isNeg ? '-' : ''}${formatIDR(num)}`;
}

export const RupiahInput = React.forwardRef<HTMLInputElement, RupiahInputProps>(
  ({ value, onValueChange, allowNegative = false, className = '', ...rest }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const pendingCaretDigitIndexRef = useRef<number | null>(null);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    };

    const displayValue = formatRawNumericForDisplay(value, allowNegative);

    useLayoutEffect(() => {
      const targetDigitIdx = pendingCaretDigitIndexRef.current;
      const el = innerRef.current;
      if (targetDigitIdx === null || !el) return;
      pendingCaretDigitIndexRef.current = null;

      let seenDigits = 0;
      let cursorPos = displayValue.length;
      for (let i = 0; i < displayValue.length; i += 1) {
        if (/\d/.test(displayValue[i])) {
          if (seenDigits === targetDigitIdx) {
            cursorPos = i;
            break;
          }
          seenDigits += 1;
        }
        if (seenDigits === targetDigitIdx) {
          cursorPos = i + 1;
        }
      }
      if (targetDigitIdx === 0) {
        cursorPos = displayValue.startsWith('-') ? 1 : 0;
      }
      try {
        el.setSelectionRange(cursorPos, cursorPos);
      } catch {
        // Ignore selection errors on unsupported elements
      }
    }, [displayValue]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawInput = e.target.value;
      const selectionStart = e.target.selectionStart ?? rawInput.length;
      const digitsBeforeCaret = rawInput.slice(0, selectionStart).replace(/\D/g, '').length;
      pendingCaretDigitIndexRef.current = digitsBeforeCaret;

      const isNeg = allowNegative && rawInput.trim().startsWith('-');
      const digitsOnly = rawInput.replace(/\D/g, '');
      if (!digitsOnly) {
        onValueChange(isNeg ? '-' : '');
        return;
      }
      const normalized = String(Number(digitsOnly));
      onValueChange(`${isNeg ? '-' : ''}${normalized}`);
    };

    return (
      <input
        ref={setRefs}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleChange}
        className={className}
        {...rest}
      />
    );
  }
);

RupiahInput.displayName = 'RupiahInput';
