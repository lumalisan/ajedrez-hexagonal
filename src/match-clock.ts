import type { MatchClockSnapshot, Outcome, Player } from './types';

/** Creates a paused, serializable two-player countdown clock. */
export function createMatchClock(
  initialSeconds: number | null,
  activePlayer: Player = 0,
  turnSeconds: number | null = null,
): MatchClockSnapshot {
  const initialMs = initialSeconds === null ? null : clockDuration(initialSeconds);
  const turnInitialMs = turnSeconds === null ? null : clockDuration(turnSeconds);
  if (initialMs === null && turnInitialMs === null)
    throw new RangeError('El reloj necesita al menos un límite de tiempo.');
  return {
    initialMs,
    remainingMs: [initialMs ?? 0, initialMs ?? 0],
    ...(turnInitialMs === null ? {} : { turnInitialMs, turnRemainingMs: turnInitialMs }),
    activePlayer,
    status: 'paused',
    lastTickAt: null,
    timedOutPlayer: null,
  };
}

/** Starts or continues the active player's clock at a caller-supplied timestamp. */
export function resumeMatchClock(
  clock: Readonly<MatchClockSnapshot>,
  nowMs: number,
): MatchClockSnapshot {
  assertClock(clock);
  assertTimestamp(nowMs);
  if (clock.status === 'timeout') return cloneClock(clock);
  if (clock.status === 'running') return tickMatchClock(clock, nowMs);
  return {
    ...cloneClock(clock),
    status: 'running',
    lastTickAt: nowMs,
  };
}

/** Charges elapsed time and pauses without relying on global wall-clock state. */
export function pauseMatchClock(
  clock: Readonly<MatchClockSnapshot>,
  nowMs: number,
): MatchClockSnapshot {
  const ticked = tickMatchClock(clock, nowMs);
  if (ticked.status === 'timeout') return ticked;
  return { ...ticked, status: 'paused', lastTickAt: null };
}

/** Charges elapsed time to the active player and reports timeout in the snapshot. */
export function tickMatchClock(
  clock: Readonly<MatchClockSnapshot>,
  nowMs: number,
): MatchClockSnapshot {
  assertClock(clock);
  assertTimestamp(nowMs);
  const next = cloneClock(clock);
  if (next.status !== 'running' || next.lastTickAt === null) return next;
  if (nowMs <= next.lastTickAt) return next;

  // Stop both reserves at the instant the first limit expires, even if the
  // caller ticks late (for example after a backgrounded browser tab).
  const elapsed = Math.min(nowMs - next.lastTickAt, activeClockRemainingMs(next));
  const player = next.activePlayer;
  if (next.initialMs !== null)
    next.remainingMs[player] = Math.max(0, next.remainingMs[player] - elapsed);
  if (next.turnRemainingMs != null)
    next.turnRemainingMs = Math.max(0, next.turnRemainingMs - elapsed);
  next.lastTickAt = nowMs;
  if (activeClockRemainingMs(next) === 0) {
    next.status = 'timeout';
    next.timedOutPlayer = player;
    next.lastTickAt = null;
  }
  return next;
}

/** Charges the old player, then assigns the clock; newTurn also handles automatic passes. */
export function switchMatchClock(
  clock: Readonly<MatchClockSnapshot>,
  activePlayer: Player,
  nowMs: number,
  newTurn = false,
): MatchClockSnapshot {
  const ticked = tickMatchClock(clock, nowMs);
  if (ticked.status === 'timeout') return ticked;
  return {
    ...ticked,
    activePlayer,
    ...(ticked.turnInitialMs != null && (newTurn || activePlayer !== ticked.activePlayer)
      ? { turnRemainingMs: ticked.turnInitialMs }
      : {}),
    lastTickAt: ticked.status === 'running' ? nowMs : null,
  };
}

/** Time until either enabled limit expires for the active player. */
export function activeClockRemainingMs(clock: Readonly<MatchClockSnapshot>): number {
  return Math.min(
    clock.initialMs === null ? Infinity : clock.remainingMs[clock.activePlayer],
    clock.turnRemainingMs ?? Infinity,
  );
}

/** Converts a timed-out clock into the canonical match result. */
export function clockOutcome(clock: Readonly<MatchClockSnapshot>): Outcome | null {
  assertClock(clock);
  if (clock.status !== 'timeout' || clock.timedOutPlayer === null) return null;
  return {
    type: 'win',
    winner: otherPlayer(clock.timedOutPlayer),
    reason: 'timeout',
  };
}

/** Runtime validation for snapshots restored from JSON. */
export function validateMatchClock(clock: Readonly<MatchClockSnapshot>): string[] {
  const errors: string[] = [];
  if (clock.initialMs !== null && (!Number.isSafeInteger(clock.initialMs) || clock.initialMs <= 0))
    errors.push('La duración inicial del reloj no es válida.');
  const hasTurnClock = clock.turnInitialMs != null;
  if (hasTurnClock && (!Number.isSafeInteger(clock.turnInitialMs) || clock.turnInitialMs! <= 0))
    errors.push('La duración inicial del turno no es válida.');
  if (clock.initialMs === null && !hasTurnClock)
    errors.push('El reloj necesita al menos un límite de tiempo.');
  if (
    !Array.isArray(clock.remainingMs) ||
    clock.remainingMs.length !== 2 ||
    clock.remainingMs.some(
      (remaining) =>
        !Number.isFinite(remaining) || remaining < 0 || remaining > (clock.initialMs ?? 0),
    )
  )
    errors.push('El tiempo restante del reloj no es válido.');
  if (
    hasTurnClock
      ? clock.turnRemainingMs == null ||
        !Number.isFinite(clock.turnRemainingMs) ||
        clock.turnRemainingMs < 0 ||
        clock.turnRemainingMs > clock.turnInitialMs!
      : clock.turnRemainingMs != null
  )
    errors.push('El tiempo restante del turno no es válido.');
  if (clock.activePlayer !== 0 && clock.activePlayer !== 1)
    errors.push('El jugador activo del reloj no es válido.');
  if (!['paused', 'running', 'timeout'].includes(clock.status))
    errors.push('El estado del reloj no es válido.');
  if (clock.lastTickAt !== null && (!Number.isFinite(clock.lastTickAt) || clock.lastTickAt < 0))
    errors.push('La marca temporal del reloj no es válida.');
  if (clock.status === 'running' && clock.lastTickAt === null)
    errors.push('Un reloj en marcha necesita una marca temporal.');
  if (clock.status !== 'running' && clock.lastTickAt !== null)
    errors.push('Solo un reloj en marcha puede conservar una marca temporal.');
  if (clock.status === 'timeout') {
    if (clock.timedOutPlayer !== 0 && clock.timedOutPlayer !== 1)
      errors.push('El reloj agotado no identifica al jugador.');
    else if (!(
      (clock.initialMs !== null && clock.remainingMs?.[clock.timedOutPlayer] === 0) ||
      (hasTurnClock && clock.turnRemainingMs === 0 && clock.timedOutPlayer === clock.activePlayer)
    ))
      errors.push('El jugador agotado todavía tiene tiempo restante.');
  } else if (clock.timedOutPlayer !== null) {
    errors.push('Solo un reloj agotado puede identificar al jugador sin tiempo.');
  } else if (
    (clock.initialMs !== null &&
      Array.isArray(clock.remainingMs) &&
      clock.remainingMs.some((remaining) => remaining === 0)) ||
    (hasTurnClock && clock.turnRemainingMs === 0)
  ) {
    errors.push('Un reloj a cero debe figurar como agotado.');
  }
  return errors;
}

function clockDuration(seconds: number): number {
  const milliseconds = Math.round(seconds * 1_000);
  if (!Number.isFinite(seconds) || !Number.isSafeInteger(milliseconds) || milliseconds <= 0)
    throw new RangeError('La duración del reloj debe ser positiva y estar dentro de rango.');
  return milliseconds;
}

function assertClock(clock: Readonly<MatchClockSnapshot>): void {
  const errors = validateMatchClock(clock);
  if (errors.length) throw new Error(errors.join(' '));
}

function assertTimestamp(nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new RangeError('La marca temporal debe ser un número no negativo.');
}

function cloneClock(clock: Readonly<MatchClockSnapshot>): MatchClockSnapshot {
  return { ...clock, remainingMs: [...clock.remainingMs] as [number, number] };
}

function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}
