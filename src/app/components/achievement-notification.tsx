import { useLayoutEffect, useRef } from 'react';
import { ACHIEVEMENTS } from '../../achievements';
import { PROGRESSION_ACHIEVEMENTS } from '../../progression';
import { useGame } from '../game-context';
import { AchievementIcon } from './achievement-icon';

export function AchievementNotification() {
  const { snapshot } = useGame();
  const notice = snapshot.achievementNotification;
  const popover = useRef<HTMLDivElement>(null);
  const definition = PROGRESSION_ACHIEVEMENTS.find((entry) => entry.id === notice?.achievementId);
  const achievement = definition
    ? { ...definition, icon: 'first-win' as const }
    : ACHIEVEMENTS.find((entry) => entry.id === notice?.achievementId);
  const hasAchievement = Boolean(achievement);

  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || typeof element.showPopover !== 'function') return;
    let active = true;
    // The dialog host enters the top layer after its children's layout effects.
    queueMicrotask(() => {
      if (!active || !element.isConnected) return;
      if (hasAchievement) element.showPopover();
      else if (element.matches(':popover-open')) element.hidePopover();
    });
    return () => {
      active = false;
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [hasAchievement, notice?.id]);

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
