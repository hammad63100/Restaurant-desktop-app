import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../utils/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  rightAddon?: string;
}

/** 40px high, light border, red focus ring (design.md section 7). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, id, type = 'text', rightAddon, ...rest },
  ref,
) {
  const [isRevealed, setIsRevealed] = useState(false);
  const inputId = id ?? `input-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const isPassword = type === 'password';
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-caption text-text-secondary">
        {label}
      </label>

      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={isPassword && isRevealed ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(
            'h-control w-full rounded-control border bg-surface px-3 text-body text-text-primary',
            'placeholder:text-text-secondary/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
            'disabled:bg-background disabled:text-text-secondary',
            error ? 'border-status-cancelled' : 'border-border',
            isPassword && 'pr-10',
            rightAddon && 'pr-12',
            className,
          )}
          {...rest}
        />

        {rightAddon && !isPassword && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-text-secondary">
            {rightAddon}
          </span>
        )}

        {isPassword && (
          <button
            type="button"
            onClick={() => setIsRevealed((current) => !current)}
            aria-label={isRevealed ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:text-text-primary"
            tabIndex={-1}
          >
            {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-caption text-status-cancelled">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-caption text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const areaId = id ?? `textarea-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={areaId} className="text-caption text-text-secondary">
        {label}
      </label>
      <textarea
        ref={ref}
        id={areaId}
        aria-invalid={Boolean(error)}
        className={cn(
          'min-h-[80px] w-full rounded-control border bg-surface px-3 py-2 text-body text-text-primary',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
          error ? 'border-status-cancelled' : 'border-border',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p role="alert" className="text-caption text-status-cancelled">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-text-secondary">{hint}</p>
      ) : null}
    </div>
  );
});
