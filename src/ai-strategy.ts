import { chooseMachineAction, searchMachineAction } from './ai';
import type { SearchMetadata } from './ai';
import type { AiDifficulty, GameAction, GameState, MatchConfig } from './types';

export interface AiBudget {
  maxMs: number;
  signal?: AbortSignal;
  onProgress?: (metadata: Readonly<SearchMetadata>) => void;
}

export interface AiStrategy {
  chooseAction(state: GameState, config: MatchConfig, budget: AiBudget): Promise<GameAction | null>;
  dispose(): void;
}

const DIFFICULTY: Record<AiDifficulty, { depth: number; maxMs: number }> = {
  recruit: { depth: 1, maxMs: 120 },
  tactical: { depth: 3, maxMs: 900 },
  commander: { depth: 5, maxMs: 2_500 },
  expert: { depth: 7, maxMs: 5_000 },
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
    const participant = config.participants[state.activePlayer];
    const difficulty = participant.difficulty ?? 'recruit';
    const personality = participant.personality ?? 'balanced';
    const seed = participant.seed;
    const choiceOptions = { difficulty, personality, seed };
    if (difficulty === 'recruit') return chooseMachineAction(state, choiceOptions);
    const settings = DIFFICULTY[difficulty];
    if (typeof Worker === 'undefined')
      return searchMachineAction(state, {
        depth: settings.depth,
        budgetMs: Math.min(settings.maxMs, budget.maxMs),
        ...choiceOptions,
        onProgress: budget.onProgress,
      });
    if (budget.signal?.aborted) return null;
    this.dispose();
    const worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });
    this.#worker = worker;
    const id = ++this.#requestId;
    return new Promise<GameAction | null>((resolve) => {
      let settled = false;
      const finish = (action: GameAction | null): void => {
        if (settled) return;
        settled = true;
        budget.signal?.removeEventListener('abort', onAbort);
        if (this.#worker === worker) this.dispose();
        resolve(action);
      };
      const onAbort = (): void => finish(null);
      budget.signal?.addEventListener('abort', onAbort, { once: true });
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return;
        if (event.data.type === 'progress') {
          budget.onProgress?.(event.data.metadata);
          return;
        }
        budget.onProgress?.(event.data.metadata);
        finish(event.data.action);
      });
      worker.addEventListener('error', () => finish(chooseMachineAction(state, choiceOptions)), {
        once: true,
      });
      worker.postMessage({
        id,
        state,
        depth: settings.depth,
        budgetMs: Math.min(settings.maxMs, budget.maxMs),
        ...choiceOptions,
      });
    });
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}

type WorkerResponse =
  | { id: number; type: 'progress'; metadata: SearchMetadata }
  | { id: number; type: 'result'; action: GameAction | null; metadata: SearchMetadata };
