import type { AchievementId } from '../../achievements';
import type { ProgressionAchievementId } from '../../progression';
import { ACHIEVEMENT_INSIGNIA, INSIGNIA_PATHS } from '../../achievement-insignia';

/** Artwork shared by the collection and unlock notices. */
export function AchievementIcon({
  icon,
  unlocked = true,
}: {
  icon: AchievementId | ProgressionAchievementId;
  unlocked?: boolean;
}) {
  if (icon in ACHIEVEMENT_INSIGNIA) {
    const { motif, legend } = ACHIEVEMENT_INSIGNIA[icon as ProgressionAchievementId];
    const tier = Number(icon[1]);
    return (
      <svg
        className={`achievement-icon achievement-insignia${unlocked ? '' : ' is-locked'}`}
        data-insignia={icon}
        data-tier={tier}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        <path className="insignia-plate" d="M12 2h40l10 10v40L52 62H12L2 52V12Z" />
        <path className="insignia-rim" d="M14 6h36l8 8v36l-8 8H14l-8-8V14Z" />
        <path className="insignia-motif" d={INSIGNIA_PATHS[motif]} transform="translate(16 10)" />
        <path className="insignia-divider" d="M12 44h40" />
        <text className="insignia-legend" x="32" y="51" textAnchor="middle">
          {legend}
        </text>
        <g className="insignia-rank">
          {Array.from({ length: tier }, (_, index) => (
            <path key={index} d={`M${32 - tier * 3 + index * 6} 55h4`} />
          ))}
        </g>
      </svg>
    );
  }
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
