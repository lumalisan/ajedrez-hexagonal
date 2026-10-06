export const PROFILE_EMBLEMS = ['fortress', 'star', 'hex'] as const;
export const PROFILE_COLORS = ['cyan', 'amber', 'mint'] as const;
export interface UserProfile {
  name: string;
  emblem: (typeof PROFILE_EMBLEMS)[number];
  color: (typeof PROFILE_COLORS)[number];
}

const STORAGE_KEY = 'hexagonal:user-profile:v1';

export function normalizeProfile(value: Partial<UserProfile>, fallback: UserProfile): UserProfile {
  return {
    name:
      typeof value.name === 'string'
        ? value.name.trim().slice(0, 24) || fallback.name
        : fallback.name,
    emblem: value.emblem && PROFILE_EMBLEMS.includes(value.emblem) ? value.emblem : fallback.emblem,
    color: value.color && PROFILE_COLORS.includes(value.color) ? value.color : fallback.color,
  };
}

export function saveUserProfile(profile: UserProfile): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function loadUserProfile(): UserProfile {
  const fallback: UserProfile = {
    name: `user${Math.floor(10000000 + Math.random() * 90000000)}`,
    emblem: 'fortress',
    color: 'cyan',
  };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      return normalizeProfile(raw, fallback);
  } catch {
    // A missing or invalid local profile falls back to a new identity.
  }
  saveUserProfile(fallback);
  return fallback;
}
