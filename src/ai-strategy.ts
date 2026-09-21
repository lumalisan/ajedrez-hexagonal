import { chooseMachineAction, searchMachineAction } from './ai';
import type { SearchMetadata } from './ai';
import { resolutionRulesForConfig } from './match-record';
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

const MAIN_THREAD_MAX_MS = 400;

export function difficultyBudget(difficulty: AiDifficulty): number {
  return DIFFICULTY[difficulty].maxMs;
}

export class WorkerAiStrategy implements AiStrategy {
  #worker: Worker | null = null;
  #cancelSearch: (() => void) | null = null;
  #requestId = 0;

  async chooseAction(
    state: GameState,
    config: MatchConfig,
    budget: AiBudget,
  ): Promise<GameAction | null> {
    if (budget.signal?.aborted) return null;
    this.dispose();
    const participant = config.participants[state.activePlayer];
    const difficulty = participant.difficulty ?? 'recruit';
    const personality = participant.personality ?? 'balanced';
    const seed = participant.seed;
    const choiceOptions = {
      difficulty,
      personality,
      seed,
      resolutionRules: resolutionRulesForConfig(config),
    };
    if (difficulty === 'recruit') return chooseMachineAction(state, choiceOptions);
    const settings = DIFFICULTY[difficulty];
    const budgetMs = Math.min(settings.maxMs, budget.maxMs);
    const searchLocally = (): GameAction | null => {
      if (budget.signal?.aborted) return null;
      const action = searchMachineAction(state, {
        depth: settings.depth,
        budgetMs: Math.min(budgetMs, MAIN_THREAD_MAX_MS),
        ...choiceOptions,
        onProgress: budget.onProgress,
      });
      return budget.signal?.aborted ? null : action;
    };
    if (typeof Worker === 'undefined') return searchLocally();
    let worker: Worker;
    try {
      worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return searchLocally();
    }
    this.#worker = worker;
    const id = ++this.#requestId;
    return new Promise<GameAction | null>((resolve, reject) => {
      let settled = false;
      const stopWorker = (): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onError);
        worker.terminate();
        if (this.#worker === worker) this.#worker = null;
      };
      const cleanup = (): void => {
        budget.signal?.removeEventListener('abort', onAbort);
        if (this.#cancelSearch === onAbort) this.#cancelSearch = null;
        stopWorker();
      };
      const finish = (action: GameAction | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(action);
      };
      const onAbort = (): void => finish(null);
      const onMessage = (event: MessageEvent<WorkerResponse>): void => {
        if (settled || event.data.id !== id) return;
        if (event.data.type === 'progress') {
          budget.onProgress?.(event.data.metadata);
          return;
        }
        budget.onProgress?.(event.data.metadata);
        finish(event.data.action);
      };
      const onError = (): void => {
        if (settled) return;
        stopWorker();
        try {
          finish(searchLocally());
        } catch (error) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        }
      };
      this.#cancelSearch = onAbort;
      budget.signal?.addEventListener('abort', onAbort, { once: true });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError, { once: true });
      worker.addEventListener('messageerror', onError, { once: true });
      if (budget.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        worker.postMessage({ id, state, depth: settings.depth, budgetMs, ...choiceOptions });
      } catch {
        onError();
      }
    });
  }

  dispose(): void {
    this.#cancelSearch?.();
    this.#worker?.terminate();
    this.#worker = null;
  }
}

type WorkerResponse =
  | { id: number; type: 'progress'; metadata: SearchMetadata }
  | { id: number; type: 'result'; action: GameAction | null; metadata: SearchMetadata };
