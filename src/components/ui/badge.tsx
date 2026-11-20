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

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'border-zinc-200/80 bg-zinc-100/80 text-zinc-700',
  emerald: 'border-emerald-200/80 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200/80 bg-amber-50 text-amber-800',
  violet: 'border-violet-200/80 bg-violet-50 text-violet-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  darkNeutral: 'border-zinc-800 bg-zinc-900/90 text-zinc-300',
  darkEmerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  darkAmber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  darkViolet: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Compact status pill with restrained light/dark semantic variants. */
export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_VARIANT_CLASSES[variant],
        className
      )}
      {...props}
    />
  );
}
