import { ModeIcon } from './mode-icon';
import { useState } from 'react';
import { Tooltip } from 'radix-ui';
import { achievementModeDescription } from '../../achievement-mode-copy';
import type { ProgressionMode } from '../../progression';

export function AchievementModes({
  modes,
  minDifficulty,
  metric,
}: {
  modes: readonly ProgressionMode[];
  minDifficulty: number;
  metric: string;
}) {
  const [open, setOpen] = useState(false);
  if (!modes.length) return null;
  const description = achievementModeDescription(modes, minDifficulty, metric);
  return (
    <span className="achievement-modes achievement-mode">
      <Tooltip.Provider delayDuration={150}>
        <Tooltip.Root open={open} onOpenChange={setOpen}>
          <Tooltip.Trigger
            asChild
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            <button type="button" aria-label={description}>
              {modes.map((mode) => (
                <span
                  key={mode}
                  className="achievement-mode-symbol"
                  data-mode={mode}
                  aria-hidden="true"
                >
                  <ModeIcon mode={mode} />
                </span>
              ))}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content
            className="achievement-mode-tooltip"
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={20}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            {description}
            <Tooltip.Arrow className="achievement-mode-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    </span>
  );
}
