import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}

export function Card({ children, className, padded = true }: CardProps) {
  return <div className={cn('card', padded && 'p-4', className)}>{children}</div>;
}

interface CardHeadingProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeading({ title, subtitle, action }: CardHeadingProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-card-title text-text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
