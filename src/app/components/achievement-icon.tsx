import type { AchievementId } from '../../achievements';

/** AI-created square artwork shared by the collection and unlock notices. */
export function AchievementIcon({
  icon,
  unlocked = true,
}: {
  icon: AchievementId;
  unlocked?: boolean;
}) {
  return (
    <img
      className={`achievement-icon${unlocked ? '' : ' is-locked'}`}
      src={`${import.meta.env.BASE_URL}achievements/${icon}.webp`}
      alt=""
      width="512"
      height="512"
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
