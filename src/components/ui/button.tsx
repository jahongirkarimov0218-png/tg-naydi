import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/components/ui/cn';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'darkPrimary'
  | 'darkSecondary'
  | 'darkDestructive';

type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#09090B] text-[#FAFAFA] shadow-xs hover:bg-zinc-800 focus-visible:ring-zinc-950/20 disabled:bg-zinc-200 disabled:text-zinc-500',
  secondary:
    'border border-zinc-200 bg-zinc-50 text-zinc-800 shadow-xs hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-zinc-950/20',
  outline:
    'border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-zinc-950/20',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-zinc-950/20',
  darkPrimary:
    'bg-zinc-50 text-zinc-950 hover:bg-zinc-200 focus-visible:ring-zinc-100/30 disabled:bg-zinc-800 disabled:text-zinc-500',
  darkSecondary:
    'border border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-zinc-100/25',
  darkDestructive:
    'border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-950/60 hover:text-red-300 focus-visible:ring-red-400/30',
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-xs',
  lg: 'h-10 px-4 text-sm',
};

/** Builds shadcn-style button classes for both `<button>` and `<a>` elements. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string
): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed',
    BUTTON_VARIANT_CLASSES[variant],
    BUTTON_SIZE_CLASSES[size],
    className
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Accessible minimalist button primitive defaulting to `type="button"`. */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}
