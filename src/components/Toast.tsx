import { create } from 'zustand';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { cn } from '../utils/cn';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Top-right toasts for success/error/info (design.md section 7). */
export const useToastStore = create<ToastState>((set) => ({
  items: [],

  push: (tone, message) => {
    const id = nextId++;
    set((state) => ({ items: [...state.items, { id, tone, message }] }));
    setTimeout(
      () => {
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      },
      tone === 'error' ? 6000 : 3500,
    );
  },

  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

/** Convenience helpers so pages do not import the store directly. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};

const TONE_STYLES: Record<ToastTone, { box: string; Icon: typeof AlertCircle }> = {
  success: { box: 'border-status-success/40 bg-white text-status-success', Icon: CheckCircle2 },
  error: { box: 'border-status-cancelled/40 bg-white text-status-cancelled', Icon: AlertCircle },
  info: { box: 'border-border bg-white text-text-primary', Icon: AlertCircle },
};

export function ToastViewport() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[320px] flex-col gap-2"
    >
      {items.map((item) => {
        const { box, Icon } = TONE_STYLES[item.tone];
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-control border p-3 text-body shadow-card',
              box,
            )}
          >
            <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-text-primary">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss message"
              className="rounded p-0.5 text-text-secondary hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
