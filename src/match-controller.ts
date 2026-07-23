import { applyAction, getLegalActionsForPiece } from './engine';
import { appendAction, replayRecord, setReplayCursor } from './match-record';
import { MatchStore } from './match-store';
import type { ActionResult, GameAction, MatchRecord } from './types';

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
    if (!legal.some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)))
      return false;
    this.store.update((current) => ({
      ...current,
      ui: { ...current.ui, pendingAction: action },
    }));
    return true;
  }

  commit(action: GameAction): ActionResult {
    const result = applyAction(this.store.getState().game, action);
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

  undo(): boolean {
    if (!this.record.config.options.allowUndo || this.record.currentAction === 0) return false;
    this.jumpTo(this.record.currentAction - 1);
    return true;
  }
}
