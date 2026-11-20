import type { HTMLAttributes } from 'react';
import { cn } from '@/components/ui/cn';

type BadgeVariant =
  | 'neutral'
  | 'emerald'
  | 'amber'
  | 'violet'
  | 'red'
  | 'darkNeutral'
  | 'darkEmerald'
  | 'darkAmber'
  | 'darkViolet';

type BadgeSize = 'sm' | 'md';

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'border-zinc-200/80 bg-zinc-100/80 text-zinc-700',
  emerald: 'border-emerald-200/80 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200/80 bg-amber-50 text-amber-900',
  violet: 'border-violet-200/80 bg-violet-50 text-violet-800',
  red: 'border-red-200 bg-red-50 text-red-700',
  darkNeutral: 'border-zinc-800 bg-zinc-900/90 text-zinc-200',
  darkEmerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  darkAmber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  darkViolet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
};

const BADGE_SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

/** Compact status pill with WCAG-checked light/dark semantic variants (12px floor). */
export function Badge({
  variant = 'neutral',
  size = 'sm',
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap',
        BADGE_VARIANT_CLASSES[variant],
        BADGE_SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
}
