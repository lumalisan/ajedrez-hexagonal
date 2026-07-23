import { chooseMachineAction, searchMachineAction } from './ai';
import type { AiDifficulty, GameAction, GameState, MatchConfig } from './types';

export interface AiBudget {
  maxMs: number;
  signal?: AbortSignal;
}

export interface AiStrategy {
  chooseAction(state: GameState, config: MatchConfig, budget: AiBudget): Promise<GameAction | null>;
  dispose(): void;
}

const DIFFICULTY: Record<AiDifficulty, { depth: 1 | 2 | 3; maxMs: number }> = {
  recruit: { depth: 1, maxMs: 120 },
  tactical: { depth: 2, maxMs: 650 },
  commander: { depth: 3, maxMs: 1_600 },
};

export function difficultyBudget(difficulty: AiDifficulty, mobile = false): number {
  const base = DIFFICULTY[difficulty].maxMs;
  return mobile ? Math.round(base * 0.65) : base;
}

export class WorkerAiStrategy implements AiStrategy {
  #worker: Worker | null = null;
  #requestId = 0;

  async chooseAction(
    state: GameState,
    config: MatchConfig,
    budget: AiBudget,
  ): Promise<GameAction | null> {
    const difficulty = config.participants[state.activePlayer].difficulty ?? 'recruit';
    if (difficulty === 'recruit') return chooseMachineAction(state);
    const settings = DIFFICULTY[difficulty];
    if (typeof Worker === 'undefined')
      return searchMachineAction(state, {
        depth: settings.depth,
        budgetMs: Math.min(settings.maxMs, budget.maxMs),
      });
    this.dispose();
    const worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });
    this.#worker = worker;
    const id = ++this.#requestId;
    return new Promise<GameAction | null>((resolve) => {
      const finish = (action: GameAction | null): void => {
        budget.signal?.removeEventListener('abort', onAbort);
        if (this.#worker === worker) this.dispose();
        resolve(action);
      };
      const onAbort = (): void => finish(null);
      budget.signal?.addEventListener('abort', onAbort, { once: true });
      worker.addEventListener(
        'message',
        (event: MessageEvent<{ id: number; action: GameAction | null }>) => {
          if (event.data.id === id) finish(event.data.action);
        },
        { once: true },
      );
      worker.addEventListener('error', () => finish(chooseMachineAction(state)), { once: true });
      worker.postMessage({
        id,
        state,
        depth: settings.depth,
        budgetMs: Math.min(settings.maxMs, budget.maxMs),
      });
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}
