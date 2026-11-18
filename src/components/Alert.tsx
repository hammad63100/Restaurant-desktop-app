import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../utils/cn';

type AlertTone = 'error' | 'success' | 'info' | 'warning';

interface AlertProps {
  tone?: AlertTone;
  children: string;
}

const TONE_STYLES: Record<AlertTone, { box: string; Icon: typeof AlertCircle }> = {
  error: {
    box: 'border-status-cancelled/30 bg-status-cancelled/10 text-status-cancelled',
    Icon: AlertCircle,
  },
  success: {
    box: 'border-status-success/30 bg-status-success/10 text-status-success',
    Icon: CheckCircle2,
  },
  info: { box: 'border-border bg-background text-text-secondary', Icon: Info },
  warning: {
    box: 'border-secondary/40 bg-secondary/10 text-[#8a5b00]',
    Icon: AlertTriangle,
  },
};

/** Inline message box. Icons plus text, so colour is never the only signal. */
export function Alert({ tone = 'error', children }: AlertProps) {
  const { box, Icon } = TONE_STYLES[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-control border p-3 text-body', box)}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
