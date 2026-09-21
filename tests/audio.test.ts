import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDirector } from '../src/audio';
import { DEFAULT_PREFERENCES } from '../src/match-storage';

function audioParameter() {
  return {
    value: 0,
    setValueAtTime: vi.fn<(value: number, time: number) => void>(),
    exponentialRampToValueAtTime: vi.fn<(value: number, time: number) => void>(),
  };
}

class GainDouble {
  gain = audioParameter();
  connect = vi.fn();
}

class OscillatorDouble {
  type = 'sine';
  frequency = audioParameter();
  connect = vi.fn();
  start = vi.fn<(time: number) => void>();
  stop = vi.fn<(time: number) => void>();
}

describe('sonido de logro', () => {
  let contexts: AudioContextDouble[];
  const musicPlay = vi.fn().mockResolvedValue(undefined);

  class AudioContextDouble {
    currentTime = 3;
    state = 'running';
    destination = {};
    gains: GainDouble[] = [];
    oscillators: OscillatorDouble[] = [];

    constructor() {
      contexts.push(this);
    }

    createGain() {
      const gain = new GainDouble();
      this.gains.push(gain);
      return gain;
    }

    createOscillator() {
      const oscillator = new OscillatorDouble();
      this.oscillators.push(oscillator);
      return oscillator;
    }
  }

  beforeEach(() => {
    contexts = [];
    musicPlay.mockClear();
    vi.stubGlobal(
      'Audio',
      class {
        volume = 0;
        loop = false;
        preload = '';
        setAttribute = vi.fn();
        play = musicPlay;
        pause = vi.fn();
      },
    );
    vi.stubGlobal('AudioContext', AudioContextDouble);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reproduce una campanilla breve con notas escalonadas sin iniciar música', () => {
    const director = new AudioDirector({ ...DEFAULT_PREFERENCES, sound: true });

    director.playAchievement();

    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    const starts = context.oscillators.map((oscillator) => oscillator.start.mock.calls[0][0]);
    expect(new Set(starts).size).toBeGreaterThan(1);
    for (const oscillator of context.oscillators) {
      const start = oscillator.start.mock.calls[0][0];
      const stop = oscillator.stop.mock.calls[0][0];
      expect(start).toBeGreaterThanOrEqual(context.currentTime);
      expect(stop).toBeGreaterThan(start);
      expect(stop - context.currentTime).toBeLessThan(1);
      expect(oscillator.connect).toHaveBeenCalledOnce();
    }
    expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
    for (const envelope of context.gains.slice(1)) {
      expect(envelope.connect).toHaveBeenCalledWith(context.gains[0]);
    }
    expect(musicPlay).not.toHaveBeenCalled();
  });

  it('respeta el volumen general y el de efectos sin depender del de música', () => {
    const director = new AudioDirector({
      ...DEFAULT_PREFERENCES,
      sound: true,
      masterVolume: 1,
      effectsVolume: 1,
    });
    director.playAchievement();
    const output = contexts[0].gains[0].gain;
    const fullVolume = output.value;
    expect(fullVolume).toBeGreaterThan(0);

    director.setVolumes(0.5, 0, 0.5);
    expect(output.value).toBeCloseTo(fullVolume * 0.25);
    director.setVolumes(0.5, 1, 0.5);
    expect(output.value).toBeCloseTo(fullVolume * 0.25);
    director.setVolumes(1, 1, 0);
    expect(output.value).toBe(0);
    director.setVolumes(0, 1, 1);
    expect(output.value).toBe(0);
  });

  it('no crea un contexto de audio cuando el sonido está desactivado', () => {
    new AudioDirector({ ...DEFAULT_PREFERENCES, sound: false }).playAchievement();
    expect(contexts).toHaveLength(0);
  });

  it('silencia un logro que esté sonando cuando se desactiva el sonido', () => {
    const director = new AudioDirector({ ...DEFAULT_PREFERENCES, sound: true });
    director.playAchievement();
    const context = contexts[0];
    const notesBeforeMute = context.oscillators.length;

    director.setEnabled(false);
    director.playAchievement();

    expect(context.gains[0].gain.value).toBe(0);
    expect(context.oscillators).toHaveLength(notesBeforeMute);
  });

  it('no interrumpe la notificación si Web Audio no está disponible', () => {
    vi.stubGlobal('AudioContext', undefined);
    const director = new AudioDirector({ ...DEFAULT_PREFERENCES, sound: true });
    expect(() => director.playAchievement()).not.toThrow();
    expect(contexts).toHaveLength(0);
  });
});
