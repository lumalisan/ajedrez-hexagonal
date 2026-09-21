import { useLayoutEffect, useRef } from 'react';
import { ACHIEVEMENTS } from '../../achievements';
import { useGame } from '../game-context';
import { AchievementIcon } from './achievement-icon';

export function AchievementNotification() {
  const { snapshot } = useGame();
  const notice = snapshot.achievementNotification;
  const popover = useRef<HTMLDivElement>(null);
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === notice?.achievementId);

  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || typeof element.showPopover !== 'function') return;
    let active = true;
    // The dialog host enters the top layer after its children's layout effects.
    queueMicrotask(() => {
      if (!active || !element.isConnected) return;
      if (achievement) element.showPopover();
      else if (element.matches(':popover-open')) element.hidePopover();
    });
    return () => {
      active = false;
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [achievement, notice?.id]);

  return (
    <div
      ref={popover}
      className="achievement-notification-host"
      popover="manual"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {achievement && (
        <div
          className="achievement-notification"
          key={notice?.id}
          data-achievement-notification={achievement.id}
        >
          <AchievementIcon icon={achievement.icon} />
          <span className="sr-only">Logro desbloqueado: </span>
          <strong>{achievement.title}</strong>
        </div>
      )}
    </div>
  );
}
