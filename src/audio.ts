import { getPiece } from './engine';
import type { GameEvent, GamePreferences, GameState, Piece } from './types';

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly music: HTMLAudioElement;
  private enabled: boolean;
  private masterVolume: number;
  private musicVolume: number;
  private effectsVolume: number;
  private musicStarted = false;
  private unavailable = false;

  constructor(preferences: GamePreferences) {
    this.enabled = preferences.sound;
    this.masterVolume = preferences.masterVolume;
    this.musicVolume = preferences.musicVolume;
    this.effectsVolume = preferences.effectsVolume;
    this.music = new Audio('/game-theme.mp3');
    this.music.loop = true;
    this.music.preload = 'auto';
    this.music.setAttribute('aria-hidden', 'true');
    this.syncLevels();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncLevels();
    if (!enabled) this.music.pause();
    else if (this.musicStarted) void this.music.play().catch(() => undefined);
  }

  setVolumes(master: number, music: number, effects: number): void {
    this.masterVolume = clamp01(master);
    this.musicVolume = clamp01(music);
    this.effectsVolume = clamp01(effects);
    this.syncLevels();
  }

  startMusic(): void {
    this.musicStarted = true;
    if (this.enabled) void this.music.play().catch(() => undefined);
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    if (this.enabled) this.playSelect();
    return this.enabled;
  }

  playSelect(): void {
    this.tone(420, 0, 0.055, 'triangle', 0.055, 520);
  }

  playInvalid(): void {
    this.tone(150, 0, 0.09, 'square', 0.045, 115);
  }

  playTurn(): void {
    this.tone(330, 0, 0.06, 'sine', 0.05, 440);
    this.tone(495, 0.07, 0.1, 'sine', 0.045, 620);
  }

  playEvents(events: GameEvent[], before: GameState): void {
    if (!this.enabled || events.length === 0) return;
    const hasVictory = events.some((event) => event.type === 'victory');
    const hasDraw = events.some((event) => event.type === 'draw');
    if (hasVictory) {
      [220, 277, 330, 440].forEach((frequency, index) => {
        this.tone(frequency, index * 0.085, 0.42, 'triangle', 0.055, frequency * 1.02);
      });
      return;
    }
    if (hasDraw) {
      this.tone(260, 0, 0.28, 'sine', 0.05, 220);
      this.tone(195, 0.09, 0.34, 'sine', 0.04, 180);
      return;
    }

    const move = events.find((event) => event.type === 'move' && event.pieceId);
    if (move?.pieceId) {
      const piece = getPiece(before, move.pieceId);
      if (piece?.type === 'drone') this.playDroneMove();
      else this.playGroundMove(piece);
    }
    if (events.some((event) => event.type === 'shoot')) this.playShot();
    if (events.some((event) => event.type === 'convert')) this.playConversion();
    if (events.some((event) => event.type === 'transform')) this.playTransformation();
    if (events.some((event) => event.type === 'intercept')) this.playInterception();
    if (events.some((event) => event.type === 'fortressDamage')) this.playFortressDamage();
    else if (events.some((event) => event.type === 'destroy')) this.playImpact();
    if (events.some((event) => event.type === 'rotate')) {
      this.tone(280, 0, 0.07, 'triangle', 0.035, 350);
    }
  }

  private playGroundMove(piece?: Piece): void {
    const heavy = piece?.type === 'fast' || piece?.type === 'antiAir';
    this.noise(0, heavy ? 0.13 : 0.09, heavy ? 0.032 : 0.02, 520);
    this.tone(heavy ? 105 : 145, 0, 0.1, 'triangle', 0.035, heavy ? 82 : 125);
  }

  private playDroneMove(): void {
    this.tone(510, 0, 0.18, 'sine', 0.025, 760);
    this.tone(760, 0.03, 0.14, 'sine', 0.018, 580);
  }

  private playShot(): void {
    this.noise(0, 0.11, 0.07, 1800);
    this.tone(180, 0, 0.16, 'sawtooth', 0.05, 60);
  }

  private playImpact(): void {
    this.noise(0.08, 0.15, 0.055, 620);
    this.tone(95, 0.07, 0.18, 'triangle', 0.05, 48);
  }

  private playConversion(): void {
    this.tone(310, 0, 0.18, 'sine', 0.04, 620);
    this.tone(465, 0.07, 0.2, 'triangle', 0.035, 780);
  }

  private playTransformation(): void {
    this.noise(0, 0.2, 0.025, 900);
    this.tone(130, 0, 0.24, 'square', 0.025, 300);
  }

  private playInterception(): void {
    this.tone(880, 0, 0.06, 'square', 0.045, 440);
    this.tone(660, 0.08, 0.07, 'square', 0.04, 260);
    this.noise(0.12, 0.12, 0.04, 1100);
  }

  private playFortressDamage(): void {
    this.tone(82, 0, 0.42, 'sawtooth', 0.065, 48);
    this.noise(0.02, 0.25, 0.045, 380);
  }

  private tone(
    frequency: number,
    delay: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    endFrequency = frequency,
  ): void {
    try {
      const audio = this.ensureContext();
      if (!audio || !this.master) return;
      const start = audio.currentTime + delay;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.018, duration / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.025);
    } catch {
      this.unavailable = true;
    }
  }

  private noise(delay: number, duration: number, volume: number, cutoff: number): void {
    try {
      const audio = this.ensureContext();
      if (!audio || !this.master) return;
      const length = Math.ceil(audio.sampleRate * duration);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / length);
      }
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      gain.gain.value = volume;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(audio.currentTime + delay);
    } catch {
      this.unavailable = true;
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled || this.unavailable) return null;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.syncLevels();
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
      return this.context;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  private syncLevels(): void {
    const active = this.enabled ? 1 : 0;
    if (this.master) this.master.gain.value = 0.72 * this.masterVolume * this.effectsVolume * active;
    this.music.volume = clamp01(0.38 * this.masterVolume * this.musicVolume * active);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
