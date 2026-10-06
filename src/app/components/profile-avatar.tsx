import type { UserProfile } from '../../user-profile';

export function ProfileAvatar({ profile }: { profile: UserProfile }) {
  return (
    <span className={`profile-avatar profile-${profile.color}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m24 3 18 10.5v21L24 45 6 34.5v-21Z" />
        {profile.emblem === 'fortress' ? (
          <path d="M15 34V16h5v5h8v-5h5v18h-7v-7h-4v7Z" />
        ) : profile.emblem === 'star' ? (
          <path d="m24 12 3.5 8 8.5 1-6.5 6 2 9-7.5-4.5-7.5 4.5 2-9-6.5-6 8.5-1Z" />
        ) : (
          <>
            <path d="m24 12 10 6v12l-10 6-10-6V18Z" />
            <path d="m24 19 4 2.5v5L24 29l-4-2.5v-5Z" />
          </>
        )}
      </svg>
    </span>
  );
}
