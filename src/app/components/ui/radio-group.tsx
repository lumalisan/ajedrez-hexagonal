import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cx } from './cx';

export type RadioGroupProps = ComponentProps<typeof RadioGroupPrimitive.Root>;

/** A single choice with roving focus and arrow-key navigation supplied by Radix. */
export function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cx('ds-radio-group grid min-w-0 gap-2.5', className)}
      {...props}
    />
  );
}

export type RadioGroupItemProps = Omit<
  ComponentProps<typeof RadioGroupPrimitive.Item>,
  'asChild'
> & {
  variant?: 'default' | 'card';
};

/** The whole option is clickable; children must not contain interactive elements. */
export function RadioGroupItem({
  className,
  children,
  variant = 'default',
  ...props
}: RadioGroupItemProps) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      data-variant={variant}
      className={cx(
        'ds-control group relative min-h-control min-w-0 cursor-pointer text-left font-ui text-sm text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'card'
          ? 'grid content-start gap-2 rounded-xl border border-solid border-line-strong bg-panel p-4 pr-11 enabled:hover:bg-panel-hover data-[state=checked]:border-accent data-[state=checked]:bg-accent/10'
          : 'flex items-center gap-3 rounded-control border-0 bg-transparent px-2 py-2 enabled:hover:bg-panel-hover',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-solid border-line-strong text-ink group-data-[state=checked]:border-accent group-data-[state=checked]:text-accent',
          variant === 'card' && 'absolute top-4 right-3',
        )}
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-current forced-colors:bg-[Highlight]" />
      </span>
      {children}
    </RadioGroupPrimitive.Item>
  );
}
