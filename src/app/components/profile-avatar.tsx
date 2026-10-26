import type { UserProfile } from '../../user-profile';
import { levelProgress } from '../../progression';
import { useGame } from '../game-context';

const EMBLEM_PATHS: Record<UserProfile['emblem'], string> = {
  fortress: 'M15 34V16h5v5h8v-5h5v18h-7v-7h-4v7Z',
  star: 'm24 12 3.5 8 8.5 1-6.5 6 2 9-7.5-4.5-7.5 4.5 2-9-6.5-6 8.5-1Z',
  hex: 'M12 24 18 14h12l6 10-6 10H18Zm7 0 2.5-4h5l2.5 4-2.5 4h-5Z',
  shield: 'm24 12 11 4v9c0 7-11 12-11 12S13 32 13 25v-9Zm-5 12 4 4 7-8',
  swords: 'm14 13 19 22m1-22L15 35m-3-9 10 9m4-1 10-9M14 13v7m0-7 7 1m13-1-7 1m7-1v7',
  crown: 'm12 19 6 6 6-12 6 12 6-6-3 16H15Zm4 11h16',
  wing: 'M13 32c0-14 10-19 23-19-1 13-7 23-22 23m2-4 16-15m-11 10h8m-3-6h6',
  flame: 'M24 12c3 9 11 12 10 19-1 9-20 9-20 0 0-6 5-8 7-13 0 8 5 9 5 9s3-6-2-15Z',
  compass: 'm24 11 4 10 9 3-9 4-4 10-4-10-9-4 9-3Zm0 10v7',
  laurel:
    'M22 36c-12-4-14-16-7-23m11 23c12-4 14-16 7-23M14 20l6 2m-7 5 7 1m14-8-6 2m7 5-7 1m-4-12v15',
};

export function ProfileAvatar({ profile, xp }: { profile: UserProfile; xp?: number }) {
  const { snapshot } = useGame();
  const { tier, category } = levelProgress(xp ?? snapshot.progression.xp);
  return (
    <span
      className={`profile-avatar profile-${profile.color}`}
      role="img"
      aria-label={`Emblema ${category}, ${tier + 1} ${tier === 0 ? 'estrella' : 'estrellas'}`}
    >
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 24 13.5 6h21L45 24 34.5 42h-21Z" />
        <path d={EMBLEM_PATHS[profile.emblem]} />
      </svg>
      <span className="profile-stars" aria-hidden="true">
        {'★'.repeat(tier + 1)}
      </span>
    </span>
  );
}
