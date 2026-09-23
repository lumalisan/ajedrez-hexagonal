import { describe, expect, it } from 'vitest';

import {
  activeClockRemainingMs,
  TURN_TIMEOUT_LIMIT,
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
  ] as const)(
    'cede a la IA al agotar el turno (total %s, turno %s)',
    (total, turn, remaining, turnRemaining) => {
      const running = resumeMatchClock(createMatchClock(total, 0, turn), 100);
      const expired = tickMatchClock(running, 100_000);
      expect(expired.remainingMs).toEqual(remaining);
      expect(expired.turnRemainingMs).toBe(turnRemaining);
      expect(expired).toMatchObject({
        status: 'turn-expired',
        turnTimeouts: [1, 0],
        lastTickAt: null,
        timedOutPlayer: null,
      });
      expect(clockOutcome(expired)).toBeNull();
      expect(tickMatchClock(expired, 200_000)).toEqual(expired);
      expect(pauseMatchClock(expired, 200_000)).toEqual(expired);
      expect(resumeMatchClock(expired, 200_000)).toEqual(expired);
      expect(switchMatchClock(expired, 0, 200_000)).toEqual(expired);
      expect(switchMatchClock(expired, 1, 200_000)).toMatchObject({
        status: 'paused',
        activePlayer: 1,
        turnRemainingMs: 30_000,
        turnTimeouts: [1, 0],
        lastTickAt: null,
      });
      expect(running.turnTimeouts).toEqual([0, 0]);
      expect(validateMatchClock(expired)).toEqual([]);
    },
  );

  it.each([5, 30])('pierde si el tiempo total de %s s se agota antes o a la vez', (total) => {
    const running = resumeMatchClock(createMatchClock(total, 0, 30), 100);
    const expired = tickMatchClock(running, 100_000);
    expect(expired.remainingMs).toEqual([0, total * 1_000]);
    expect(expired.turnRemainingMs).toBe((30 - total) * 1_000);
    expect(expired.turnTimeouts).toEqual([0, 0]);
    expect(clockOutcome(expired)).toEqual({ type: 'win', winner: 1, reason: 'timeout' });
    expect(switchMatchClock(expired, 1, 200_000)).toEqual(expired);
  });

  it('acumula por jugador y pierde al agotar su tercer turno, aunque no sean consecutivos', () => {
    let clock = createMatchClock(null, 0, 1);
    let now = 0;
    for (let count = 1; count <= TURN_TIMEOUT_LIMIT; count += 1) {
      clock = resumeMatchClock(clock, now);
      clock = tickMatchClock(clock, (now += 1_000));
      expect(clock.turnTimeouts).toEqual([count, count - 1]);
      if (count === TURN_TIMEOUT_LIMIT) break;
      clock = resumeMatchClock(switchMatchClock(clock, 1, now), now);
      clock = tickMatchClock(clock, (now += 1_000));
      expect(clock.turnTimeouts).toEqual([count, count]);
      expect(clock.status).toBe('turn-expired');
      expect(clockOutcome(clock)).toBeNull();
      clock = switchMatchClock(clock, 0, now);
    }
    expect(clock).toMatchObject({ status: 'timeout', timedOutPlayer: 0, turnTimeouts: [3, 2] });
    expect(clockOutcome(clock)).toEqual({ type: 'win', winner: 1, reason: 'timeout' });
    expect(resumeMatchClock(clock, now + 1_000)).toEqual(clock);
  });

  it('renueva un turno agotado del mismo jugador tras el pase automático del rival', () => {
    const expired = tickMatchClock(resumeMatchClock(createMatchClock(null, 1, 1), 0), 1_000);
    const next = switchMatchClock(expired, 1, 2_000, true);
    expect(next).toMatchObject({
      activePlayer: 1,
      turnRemainingMs: 1_000,
      status: 'paused',
      turnTimeouts: [0, 1],
    });
    expect(validateMatchClock(next)).toEqual([]);
  });

  it('valida contadores y no permite reanudar una tercera expiración', () => {
    const clock = createMatchClock(null, 0, 1);
    for (const turnTimeouts of [[-1, 0], [0.5, 0], [4, 0], [0], [0, 0, 0]]) {
      const malformed = JSON.parse(JSON.stringify({ ...clock, turnTimeouts })) as typeof clock;
      expect(validateMatchClock(malformed)).toContain(
        'El contador de turnos agotados no es válido.',
      );
    }
    expect(validateMatchClock({ ...clock, turnTimeouts: [3, 0] })).toContain(
      'Tres turnos agotados deben finalizar la partida.',
    );
    expect(validateMatchClock({ ...clock, status: 'turn-expired', turnRemainingMs: 0 })).toContain(
      'El turno agotado necesita una expiración pendiente no terminal.',
    );
    expect(
      validateMatchClock({
        ...clock,
        status: 'timeout',
        turnRemainingMs: 0,
        turnTimeouts: [1, 0],
        timedOutPlayer: 0,
      }),
    ).toContain('La derrota por turnos agotados requiere tres expiraciones.');
  });

  it('inicializa el contador al primer agotamiento de un reloj antiguo', () => {
    const legacy = createMatchClock(null, 1, 1);
    delete legacy.turnTimeouts;
    const expired = tickMatchClock(resumeMatchClock(legacy, 0), 1_000);
    expect(expired).toMatchObject({ status: 'turn-expired', turnTimeouts: [0, 1] });
    expect(legacy.turnTimeouts).toBeUndefined();
  });

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
