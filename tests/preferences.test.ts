import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPreferences, savePreferences } from '../src/match-storage';
import { installMemoryStorage } from './helpers/memory-storage';

describe('preferencia de animaciones de fichas en reposo', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('desactiva el idle por defecto sin activar el movimiento reducido', () => {
    expect(loadPreferences()).toMatchObject({ idleAnimations: false, reducedMotion: false });
  });

  it.each(['atlas-preferences-v1', 'atlas-preferences-v2'])(
    'desactiva el idle en preferencias anteriores de %s y conserva sus ajustes',
    (key) => {
      localStorage.setItem(key, JSON.stringify({ sound: false, highContrast: true }));

      expect(loadPreferences()).toMatchObject({
        idleAnimations: false,
        reducedMotion: false,
        sound: false,
        highContrast: true,
      });
    },
  );

  it('recuerda la activación y la posterior desactivación del idle', () => {
    savePreferences({ ...loadPreferences(), idleAnimations: true });
    expect(loadPreferences()).toMatchObject({ idleAnimations: true, reducedMotion: false });

    savePreferences({ ...loadPreferences(), idleAnimations: false });
    expect(loadPreferences()).toMatchObject({ idleAnimations: false, reducedMotion: false });
  });

  it.each(['true', 1, null])('ignora un valor de idle malformado: %s', (idleAnimations) => {
    localStorage.setItem('atlas-preferences-v2', JSON.stringify({ idleAnimations }));
    expect(loadPreferences().idleAnimations).toBe(false);
  });
});
