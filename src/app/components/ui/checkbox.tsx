import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cx } from './cx';

export type CheckboxProps = Omit<
  ComponentProps<typeof CheckboxPrimitive.Root>,
  'children' | 'asChild'
>;

/** Always pair with a visible label. The 44px target contains a compact visual indicator. */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      className={cx(
        'ds-checkbox group/checkbox inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent p-0 text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span
        className="ds-checkbox-box pointer-events-none flex size-5 items-center justify-center rounded border border-solid border-line-strong bg-panel group-data-[state=checked]/checkbox:border-accent group-data-[state=checked]/checkbox:bg-accent/10 group-data-[state=indeterminate]/checkbox:border-accent group-aria-invalid/checkbox:border-danger"
        aria-hidden="true"
      >
        <CheckboxPrimitive.Indicator className="ds-checkbox-indicator flex items-center justify-center">
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 8 3 3 7-7" className="group-data-[state=indeterminate]/checkbox:hidden" />
            <path d="M4 8h8" className="hidden group-data-[state=indeterminate]/checkbox:block" />
          </svg>
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}
