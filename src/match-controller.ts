import { applyAction, getLegalActionsForPiece } from './engine';
import { sameAction } from './action-identity';
import {
  appendAction,
  concludeMatch,
  replayRecord,
  resolutionRulesForConfig,
  setMatchClock,
  setReplayCursor,
} from './match-record';
import {
  clockOutcome,
  pauseMatchClock,
  resumeMatchClock,
  switchMatchClock,
  tickMatchClock,
} from './match-clock';
import { MatchStore } from './match-store';
import type {
  ActionResult,
  GameAction,
  MatchClockSnapshot,
  MatchRecord,
  Outcome,
  Player,
} from './types';

export class MatchController {
  record: MatchRecord;
  readonly store: MatchStore;

  constructor(record: MatchRecord) {
    this.record = record;
    this.store = new MatchStore(replayRecord(record));
  }

  legalActions(pieceId: string): GameAction[] {
    return getLegalActionsForPiece(this.store.getState().game, pieceId);
  }

  prepare(action: GameAction): boolean {
    const legal = this.legalActions(action.pieceId);
    if (!legal.some((candidate) => sameAction(candidate, action))) return false;
    this.store.update((current) => ({
      ...current,
      ui: { ...current.ui, pendingAction: action },
    }));
    return true;
  }

  commit(action: GameAction): ActionResult {
    const result = applyAction(
      this.store.getState().game,
      action,
      resolutionRulesForConfig(this.record.config),
    );
    if (!result.ok) return result;
    this.record = appendAction(this.record, action);
    this.store.update((current) => ({
      game: result.state,
      ui: {
        ...current.ui,
        selectedPieceId: null,
        pendingAction: null,
        interactionMode: { kind: 'default' },
        lastEvents: result.events,
      },
    }));
    return result;
  }

  jumpTo(currentAction: number): void {
    this.record = setReplayCursor(this.record, currentAction);
    this.store.replaceGame(replayRecord(this.record));
  }

  canUndo(): boolean {
    return this.canNavigateHistory() && this.record.currentAction > 0;
  }

  canRedo(): boolean {
    return this.canNavigateHistory() && this.record.currentAction < this.record.actions.length;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.jumpTo(this.record.currentAction - 1);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.jumpTo(this.record.currentAction + 1);
    return true;
  }

  conclude(outcome: Outcome): void {
    this.record = concludeMatch(this.record, outcome);
    this.store.replaceGame(replayRecord(this.record));
  }

  resign(player: Player): void {
    this.conclude({
      type: 'win',
      winner: player === 0 ? 1 : 0,
      reason: 'resignation',
    });
  }

  resumeClock(nowMs: number): MatchClockSnapshot | null {
    return this.updateClock((clock) => resumeMatchClock(clock, nowMs));
  }

  pauseClock(nowMs: number): MatchClockSnapshot | null {
    return this.updateClock((clock) => pauseMatchClock(clock, nowMs));
  }

  tickClock(nowMs: number): MatchClockSnapshot | null {
    return this.updateClock((current) => tickMatchClock(current, nowMs));
  }

  switchClock(activePlayer: Player, nowMs: number, newTurn = false): MatchClockSnapshot | null {
    return this.updateClock((current) => switchMatchClock(current, activePlayer, nowMs, newTurn));
  }

  private canNavigateHistory(): boolean {
    if (!this.record.config.options.allowUndo) return false;
    const reason = this.record.conclusion?.outcome.reason;
    return reason !== 'resignation' && reason !== 'timeout' && reason !== 'blockade';
  }

  private updateClock(
    update: (clock: Readonly<MatchClockSnapshot>) => MatchClockSnapshot,
  ): MatchClockSnapshot | null {
    if (!this.record.clock) return null;
    const clock = update(this.record.clock);
    this.record = setMatchClock(this.record, clock);
    const outcome = clockOutcome(clock);
    if (outcome && !this.store.getState().game.outcome) this.conclude(outcome);
    return clock;
  }
}
