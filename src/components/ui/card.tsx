import type { HTMLAttributes } from 'react';
import { cn } from '@/components/ui/cn';

/** Minimalist 1px-bordered card container matching shadcn/ui neutral surface tokens. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-zinc-200/80 bg-card text-card-foreground shadow-xs',
        className
      )}
      {...props}
    />
  );
}
