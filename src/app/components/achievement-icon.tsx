import type { AchievementId } from '../../achievements';
import type { ProgressionAchievementId } from '../../progression';
import { PROGRESSION_ACHIEVEMENTS } from '../../progression-catalog';

const progressionIcons = new Set<string>(PROGRESSION_ACHIEVEMENTS.map(({ id }) => id));

/** Artwork shared by the collection and unlock notices. */
export function AchievementIcon({
  icon,
  unlocked = true,
}: {
  icon: AchievementId | ProgressionAchievementId;
  unlocked?: boolean;
}) {
  const hexagonal = progressionIcons.has(icon);
  return (
    <img
      className={`achievement-icon${hexagonal ? ' achievement-insignia' : ''}${unlocked ? '' : ' is-locked'}`}
      data-insignia={hexagonal ? icon : undefined}
      src={`${import.meta.env.BASE_URL}achievements/${hexagonal ? 'hexagonal/' : ''}${icon}.webp`}
      alt=""
      aria-hidden="true"
      width="512"
      height={hexagonal ? 400 : 512}
      decoding="async"
    />
  );
}

export function AchievementsMenuIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3h10v5a5 5 0 0 1-10 0Zm0 2H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4m-4 1v6m-4 2h8" />
    </svg>
  );
}
