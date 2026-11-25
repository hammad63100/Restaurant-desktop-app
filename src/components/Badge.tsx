import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

export type BadgeTone = 'neutral' | 'success' | 'pending' | 'info' | 'danger' | 'accent';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-background text-text-secondary',
  success: 'bg-status-success/15 text-status-success',
  pending: 'bg-secondary/20 text-[#8a6100]',
  info: 'bg-status-preparing/15 text-status-preparing',
  danger: 'bg-status-cancelled/10 text-status-cancelled',
  accent: 'bg-accent/15 text-[#9a5200]',
};

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
