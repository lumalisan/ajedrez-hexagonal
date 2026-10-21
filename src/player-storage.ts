import { PLAYER_DATA_KEYS, type PlayerData } from './cloud-contracts.js';

let scope: string | null = null;
const listeners = new Set<(userId: string) => void>();
const scopedKey = (key: string, userId = scope) =>
  userId ? `hexfortia:account:${userId}:${key}` : key;

/** Switched only after the previous GameSession has been disposed synchronously. */
export function setPlayerStorageScope(userId: string | null): void {
  scope = userId;
}
export function onPlayerStorageChange(listener: (userId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const playerStorage = {
  getItem(key: string) {
    return localStorage.getItem(scopedKey(key));
  },
  setItem(key: string, value: string) {
    const target = scopedKey(key);
    if (localStorage.getItem(target) === value) return;
    localStorage.setItem(target, value);
    if (scope) for (const listener of listeners) listener(scope);
  },
  removeItem(key: string) {
    const target = scopedKey(key);
    if (localStorage.getItem(target) === null) return;
    localStorage.removeItem(target);
    if (scope) for (const listener of listeners) listener(scope);
  },
};
export function readPlayerData(userId: string | null): PlayerData {
  const data: PlayerData = {};
  for (const key of PLAYER_DATA_KEYS) {
    const value = localStorage.getItem(scopedKey(key, userId));
    if (value !== null) data[key] = value;
  }
  return data;
}
/** Hydration does not generate new uploads. Guest keys are never overwritten by an account. */
export function replacePlayerData(userId: string, data: PlayerData): void {
  for (const key of PLAYER_DATA_KEYS) {
    const value = data[key];
    const target = scopedKey(key, userId);
    if (value === undefined) localStorage.removeItem(target);
    else localStorage.setItem(target, value);
  }
}
