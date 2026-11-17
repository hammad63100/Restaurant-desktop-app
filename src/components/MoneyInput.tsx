import { forwardRef, useState } from 'react';
import { Input } from './Input';
import { paisaToInput, parseAmountToPaisa } from '../utils/format';

interface MoneyInputProps {
  label: string;
  /** Integer paisa from the store/form state. */
  value: number;
  onChange: (paisa: number) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  suffix?: string;
  /** Called when the typed text cannot be parsed (e.g. "12.345"). */
  onInvalid?: (message: string) => void;
}

/**
 * Typed input in rupees that always hands integer paisa to its caller.
 * Keeps a text buffer so the user can type "1250." without the field fighting back.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { label, value, onChange, error, hint, disabled, suffix = 'Rs', onInvalid },
  ref,
) {
  const [text, setText] = useState(() => paisaToInput(value));
  const [localError, setLocalError] = useState<string | undefined>();

  const handleChange = (raw: string) => {
    setText(raw);

    if (raw.trim() === '') {
      setLocalError(undefined);
      onChange(0);
      return;
    }

    const paisa = parseAmountToPaisa(raw);
    if (paisa === null) {
      const message = 'Enter an amount like 250 or 250.50';
      setLocalError(message);
      onInvalid?.(message);
      return;
    }

    setLocalError(undefined);
    onChange(paisa);
  };

  return (
    <Input
      ref={ref}
      label={label}
      inputMode="decimal"
      value={text}
      onChange={(event) => handleChange(event.target.value)}
      error={error ?? localError}
      hint={hint}
      disabled={disabled}
      className="tabular"
      placeholder="0.00"
      rightAddon={suffix}
    />
  );
});
