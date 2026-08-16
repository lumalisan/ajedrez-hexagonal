import { describe, expect, it } from 'vitest';

import {
  clockOutcome,
  createMatchClock,
  pauseMatchClock,
  resumeMatchClock,
  switchMatchClock,
  tickMatchClock,
  validateMatchClock,
} from '../src/match-clock';

describe('reloj de partida puro', () => {
  it('crea dos reservas iguales y comienza pausado', () => {
    const clock = createMatchClock(300, 1);
    expect(clock).toEqual({
      initialMs: 300_000,
      remainingMs: [300_000, 300_000],
      activePlayer: 1,
      status: 'paused',
      lastTickAt: null,
      timedOutPlayer: null,
    });
    expect(validateMatchClock(clock)).toEqual([]);
  });

  it('solo descuenta al jugador activo mientras está en marcha', () => {
    const original = createMatchClock(10);
    const running = resumeMatchClock(original, 1_000);
    const ticked = tickMatchClock(running, 3_500);
    expect(ticked.remainingMs).toEqual([7_500, 10_000]);
    expect(original.remainingMs).toEqual([10_000, 10_000]);

    const switched = switchMatchClock(ticked, 1, 4_000);
    expect(switched.remainingMs).toEqual([7_000, 10_000]);
    expect(switched.activePlayer).toBe(1);
    expect(tickMatchClock(switched, 5_250).remainingMs).toEqual([7_000, 8_750]);
  });

  it('pausa cobrando el último intervalo y no descuenta durante la pausa', () => {
    const running = resumeMatchClock(createMatchClock(5), 100);
    const paused = pauseMatchClock(running, 1_100);
    expect(paused).toMatchObject({ status: 'paused', lastTickAt: null });
    expect(paused.remainingMs).toEqual([4_000, 5_000]);
    expect(tickMatchClock(paused, 20_000)).toEqual(paused);
  });

  it('agota en cero, se congela y produce victoria rival', () => {
    const running = resumeMatchClock(createMatchClock(2, 1), 10);
    const timeout = tickMatchClock(running, 3_010);
    expect(timeout).toMatchObject({
      remainingMs: [2_000, 0],
      status: 'timeout',
      timedOutPlayer: 1,
      lastTickAt: null,
    });
    expect(clockOutcome(timeout)).toEqual({ type: 'win', winner: 0, reason: 'timeout' });
    expect(resumeMatchClock(timeout, 4_000)).toEqual(timeout);
  });

  it('ignora marcas atrasadas y rechaza snapshots imposibles', () => {
    const running = resumeMatchClock(createMatchClock(5), 1_000);
    expect(tickMatchClock(running, 500)).toEqual(running);
    expect(
      validateMatchClock({
        ...running,
        status: 'timeout',
        lastTickAt: null,
        timedOutPlayer: 0,
      }),
    ).toContain('El jugador agotado todavía tiene tiempo restante.');
    expect(
      validateMatchClock({
        ...running,
        remainingMs: [0, 5_000],
        status: 'paused',
        lastTickAt: null,
      }),
    ).toContain('Un reloj a cero debe figurar como agotado.');
    expect(() => createMatchClock(0)).toThrow(RangeError);
  });

  it('sobrevive a una ida y vuelta JSON sin perder precisión', () => {
    const snapshot = tickMatchClock(resumeMatchClock(createMatchClock(12.5), 100), 345.5);
    const restored = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(restored).toEqual(snapshot);
    expect(validateMatchClock(restored)).toEqual([]);
  });
});
