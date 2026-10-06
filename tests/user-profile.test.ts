import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUserProfile, saveUserProfile } from '../src/user-profile';
import { installMemoryStorage } from './helpers/memory-storage';

describe('perfil local', () => {
  beforeEach(() => installMemoryStorage());

  it('genera un nombre y conserva la identidad entre cargas', () => {
    const profile = loadUserProfile();
    expect(profile.name).toMatch(/^user\d{8}$/);
    expect(loadUserProfile()).toEqual(profile);
  });

  it('recupera el nombre y la apariencia personalizados', () => {
    const profile = { name: 'Hexfortia', emblem: 'star', color: 'amber' } as const;
    expect(saveUserProfile(profile)).toBe(true);
    expect(loadUserProfile()).toEqual(profile);
  });

  it('recupera un perfil válido cuando el almacenamiento contiene datos incorrectos', () => {
    localStorage.setItem(
      'hexagonal:user-profile:v1',
      '{"name":42,"emblem":"unknown","color":null}',
    );
    expect(loadUserProfile()).toMatchObject({
      name: expect.stringMatching(/^user\d{8}$/),
      emblem: 'fortress',
      color: 'cyan',
    });
  });

  it('tolera que el navegador impida guardar el perfil', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(() => loadUserProfile()).not.toThrow();
    expect(saveUserProfile({ name: 'Cian', emblem: 'hex', color: 'mint' })).toBe(false);
    vi.restoreAllMocks();
  });
});
