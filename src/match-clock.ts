import type { MatchClockSnapshot, Outcome, Player } from './types';

/** Creates a paused, serializable two-player countdown clock. */
export function createMatchClock(
  initialSeconds: number,
  activePlayer: Player = 0,
): MatchClockSnapshot {
  if (!Number.isFinite(initialSeconds) || initialSeconds <= 0)
    throw new RangeError('La duración del reloj debe ser positiva.');
  const initialMs = Math.round(initialSeconds * 1_000);
  if (!Number.isSafeInteger(initialMs) || initialMs <= 0)
    throw new RangeError('La duración del reloj está fuera de rango.');
  return {
    initialMs,
    remainingMs: [initialMs, initialMs],
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

  const elapsed = nowMs - next.lastTickAt;
  const player = next.activePlayer;
  next.remainingMs[player] = Math.max(0, next.remainingMs[player] - elapsed);
  next.lastTickAt = nowMs;
  if (next.remainingMs[player] === 0) {
    next.status = 'timeout';
    next.timedOutPlayer = player;
    next.lastTickAt = null;
  }
  return next;
}

/** Charges the old player, then assigns the clock to the supplied player. */
export function switchMatchClock(
  clock: Readonly<MatchClockSnapshot>,
  activePlayer: Player,
  nowMs: number,
): MatchClockSnapshot {
  const ticked = tickMatchClock(clock, nowMs);
  if (ticked.status === 'timeout') return ticked;
  return {
    ...ticked,
    activePlayer,
    lastTickAt: ticked.status === 'running' ? nowMs : null,
  };
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
  if (!Number.isSafeInteger(clock.initialMs) || clock.initialMs <= 0)
    errors.push('La duración inicial del reloj no es válida.');
  if (
    !Array.isArray(clock.remainingMs) ||
    clock.remainingMs.length !== 2 ||
    clock.remainingMs.some(
      (remaining) => !Number.isFinite(remaining) || remaining < 0 || remaining > clock.initialMs,
    )
  )
    errors.push('El tiempo restante del reloj no es válido.');
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
    else if (clock.remainingMs[clock.timedOutPlayer] !== 0)
      errors.push('El jugador agotado todavía tiene tiempo restante.');
  } else if (clock.timedOutPlayer !== null) {
    errors.push('Solo un reloj agotado puede identificar al jugador sin tiempo.');
  } else if (clock.remainingMs.some((remaining) => remaining === 0)) {
    errors.push('Un reloj a cero debe figurar como agotado.');
  }
  return errors;
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
