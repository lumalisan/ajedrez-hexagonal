import type { ComponentProps } from 'react';
import { cx } from './cx';

const variants = {
  primary: 'border-accent bg-accent text-on-accent enabled:hover:brightness-110',
  secondary: 'border-line-strong bg-panel-raised text-ink enabled:hover:bg-panel-hover',
  ghost: 'border-transparent bg-transparent text-ink enabled:hover:bg-panel-hover',
  danger: 'border-danger bg-danger text-on-accent enabled:hover:brightness-110',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof variants;
  size?: 'default' | 'compact' | 'icon';
  /** Keep the action label visible while preventing duplicate submissions. */
  loading?: boolean;
}

/** Native button semantics: never submits a form unless type="submit" is explicit. */
export function Button({
  variant = 'secondary',
  size = 'default',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy'] || undefined}
      data-slot="button"
      data-variant={variant}
      className={cx(
        'ds-control inline-flex min-h-control min-w-control items-center justify-center gap-2 rounded-control border border-solid font-ui text-sm leading-snug font-semibold text-center no-underline',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        size === 'icon' ? 'p-2' : size === 'compact' ? 'px-3 py-2' : 'px-4 py-2.5',
        variants[variant],
        className,
      )}
    >
      {loading && <span aria-hidden="true">…</span>}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonProps,
  'aria-label' | 'aria-labelledby' | 'size'
> {
  /** Accessible action name, e.g. "Cerrar configuración". */
  label: string;
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      size="icon"
      variant={variant}
      aria-label={label}
      className={cx('shrink-0', className)}
    >
      <span className="inline-flex items-center justify-center" aria-hidden="true">
        {children}
      </span>
    </Button>
  );
}
