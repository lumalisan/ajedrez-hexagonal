import { describe, expect, it } from 'vitest';

import {
  activeClockRemainingMs,
  clockOutcome,
  createMatchClock,
  pauseMatchClock,
  resumeMatchClock,
  switchMatchClock,
  tickMatchClock,
  validateMatchClock,
} from '../src/match-clock';

describe('reloj de partida puro', () => {
  it('reinicia el tiempo por turno solo al cambiar de jugador', () => {
    const initial = createMatchClock(null, 0, 30);
    const running = resumeMatchClock(initial, 1_000);
    const paused = pauseMatchClock(running, 6_000);
    expect(paused.turnRemainingMs).toBe(25_000);
    const resumed = resumeMatchClock(paused, 100_000);
    expect(resumed.turnRemainingMs).toBe(25_000);
    const samePlayer = switchMatchClock(resumed, 0, 102_000);
    expect(samePlayer.turnRemainingMs).toBe(23_000);
    const nextPlayer = switchMatchClock(samePlayer, 1, 104_000);
    expect(nextPlayer.turnRemainingMs).toBe(30_000);
    expect(nextPlayer.remainingMs).toEqual([0, 0]);
    expect(initial.turnRemainingMs).toBe(30_000);
    expect(validateMatchClock(nextPlayer)).toEqual([]);
  });

  it('descuenta los dos límites y conserva el total al renovar el turno', () => {
    const first = resumeMatchClock(createMatchClock(300, 0, 30), 0);
    const second = switchMatchClock(first, 1, 20_000);
    expect(second.remainingMs).toEqual([280_000, 300_000]);
    expect(second.turnRemainingMs).toBe(30_000);
    const returned = switchMatchClock(second, 0, 25_000);
    expect(returned.remainingMs).toEqual([280_000, 295_000]);
    expect(returned.turnRemainingMs).toBe(30_000);
    expect(activeClockRemainingMs(returned)).toBe(30_000);
  });

  it('renueva explícitamente un turno consecutivo del mismo jugador tras un pase', () => {
    const running = resumeMatchClock(createMatchClock(300, 0, 30), 0);
    const nextTurn = switchMatchClock(running, 0, 29_000, true);
    expect(nextTurn.activePlayer).toBe(0);
    expect(nextTurn.turnRemainingMs).toBe(30_000);
    expect(nextTurn.remainingMs).toEqual([271_000, 300_000]);
  });

  it.each([
    [null, 30, [0, 0], 0],
    [300, 30, [270_000, 300_000], 0],
    [5, 30, [0, 5_000], 25_000],
  ] as const)(
    'pierde al agotar el primer límite (total %s, turno %s)',
    (total, turn, remaining, turnRemaining) => {
      const running = resumeMatchClock(createMatchClock(total, 0, turn), 100);
      const expired = tickMatchClock(running, 100_000);
      expect(expired.remainingMs).toEqual(remaining);
      expect(expired.turnRemainingMs).toBe(turnRemaining);
      expect(expired.status).toBe('timeout');
      expect(clockOutcome(expired)).toEqual({ type: 'win', winner: 1, reason: 'timeout' });
      expect(switchMatchClock(expired, 1, 200_000)).toEqual(expired);
      expect(validateMatchClock(expired)).toEqual([]);
    },
  );

  it('rechaza un reloj sin límites y reservas por turno incoherentes', () => {
    expect(() => createMatchClock(null)).toThrow(RangeError);
    const clock = createMatchClock(null, 0, 30);
    expect(validateMatchClock({ ...clock, turnRemainingMs: 31_000 })).not.toEqual([]);
    expect(validateMatchClock({ ...clock, turnRemainingMs: null })).not.toEqual([]);
    expect(validateMatchClock({ ...clock, turnInitialMs: null })).not.toEqual([]);
  });

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
