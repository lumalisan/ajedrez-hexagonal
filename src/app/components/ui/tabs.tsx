import type { ComponentProps } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cx } from './cx';

export const plainTabClassName =
  'min-h-11 cursor-pointer rounded-control border border-transparent bg-transparent px-3 py-2 font-ui text-sm font-semibold text-muted transition-colors hover:bg-panel-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan aria-selected:border-line-strong aria-selected:bg-panel-raised aria-selected:text-ink aria-pressed:border-line-strong aria-pressed:bg-panel-raised aria-pressed:text-ink data-[state=active]:border-line-strong data-[state=active]:bg-panel-raised data-[state=active]:text-ink';

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cx('min-h-0 min-w-0', className)} {...props} />
  );
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cx('min-w-0 text-muted', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { variant?: 'default' | 'plain' }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cx(
        variant === 'plain'
          ? plainTabClassName
          : 'ds-control min-h-control cursor-pointer rounded-control border border-solid border-line bg-panel-raised px-3 py-2 text-left font-semibold text-muted enabled:hover:border-line-strong enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=active]:border-amber data-[state=active]:bg-amber/10 data-[state=active]:text-amber',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cx(
        'min-h-0 min-w-0 text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}
