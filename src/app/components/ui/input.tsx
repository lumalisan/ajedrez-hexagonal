import type { ComponentProps } from 'react';
import { cx } from './cx';

const inputClasses =
  'box-border min-h-11 w-full min-w-0 rounded-control border border-solid border-line-strong bg-panel px-3 py-2 font-ui text-base leading-snug text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger';

/** Provide a visible label through Field or a native label with a matching htmlFor. */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input {...props} type={type} className={cx('ds-input', inputClasses, className)} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={cx('ds-textarea resize-y', inputClasses, className)}
    />
  );
}
