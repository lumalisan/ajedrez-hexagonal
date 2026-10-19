import { searchMachineAction } from './ai';
import type { SearchMetadata } from './ai';
import { createNeuralEvaluator } from './ai-neural';
import { resolutionRulesForConfig } from './match-record';
import type { AiDifficulty, GameAction, GameState, MatchConfig } from './types';

export interface AiBudget {
  maxMs: number;
  signal?: AbortSignal;
  onProgress?: (metadata: Readonly<SearchMetadata>) => void;
  onFallback?: (message: string) => void;
}

export interface AiStrategy {
  chooseAction(state: GameState, config: MatchConfig, budget: AiBudget): Promise<GameAction | null>;
  dispose(): void;
}

const DIFFICULTY: Record<AiDifficulty, { depth: number; maxMs: number }> = {
  recruit: { depth: 1, maxMs: 250 },
  tactical: { depth: 3, maxMs: 2_000 },
  commander: { depth: 5, maxMs: 5_000 },
  expert: { depth: 9, maxMs: 15_000 },
  neural: { depth: 9, maxMs: 15_000 },
};

const MAIN_THREAD_MAX_MS = 400;

export function difficultyBudget(difficulty: AiDifficulty): number {
  return DIFFICULTY[difficulty].maxMs;
}

async function loadBundledNeuralModel(signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(new URL('./ai-models/hex-value.bin', import.meta.url), { signal });
  if (!response.ok) throw new Error('No se pudo cargar el modelo neuronal.');
  const bytes = await response.arrayBuffer();
  createNeuralEvaluator(bytes);
  return bytes;
}

export class WorkerAiStrategy implements AiStrategy {
  #worker: Worker | null = null;
  #cancelSearch: (() => void) | null = null;
  #requestId = 0;
  readonly #modelBytes?: ArrayBuffer;
  #bundledModelBytes?: ArrayBuffer;
  #operation = 0;

  /** Experimental model supplied explicitly; normal matches retain classic Expert. */
  constructor(modelBytes?: ArrayBuffer) {
    this.#modelBytes = modelBytes?.slice(0);
  }

  /** Explicit candidate factory for experiments, independent of the selected level. */
  static async createNeuralCandidate(): Promise<WorkerAiStrategy> {
    return new WorkerAiStrategy(await loadBundledNeuralModel());
  }

  async #loadNeuralModel(signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
    if (this.#bundledModelBytes) return this.#bundledModelBytes;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    this.#cancelSearch = abort;
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const bytes = await loadBundledNeuralModel(controller.signal);
      if (controller.signal.aborted) return undefined;
      this.#bundledModelBytes = bytes;
      return bytes;
    } catch (error) {
      if (controller.signal.aborted) return undefined;
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.#cancelSearch === abort) this.#cancelSearch = null;
    }
  }

  async chooseAction(
    state: GameState,
    config: MatchConfig,
    budget: AiBudget,
  ): Promise<GameAction | null> {
    if (budget.signal?.aborted) return null;
    this.dispose();
    const operation = this.#operation;
    const participant = config.participants[state.activePlayer];
    const difficulty = participant.difficulty ?? 'recruit';
    let modelBytes = this.#modelBytes;
    if (difficulty === 'neural' && !modelBytes) {
      try {
        modelBytes = await this.#loadNeuralModel(budget.signal);
      } catch {
        if (budget.signal?.aborted || operation !== this.#operation) return null;
        budget.onFallback?.(
          'No se pudo cargar la red. Experto jugará este turno; se reintentará en el siguiente.',
        );
      }
      if (budget.signal?.aborted || operation !== this.#operation) return null;
    }
    const personality = participant.personality ?? 'balanced';
    const seed = participant.seed;
    const choiceOptions = {
      difficulty: difficulty === 'neural' ? ('expert' as const) : difficulty,
      personality,
      seed,
      resolutionRules: resolutionRulesForConfig(config),
    };
    const settings = DIFFICULTY[difficulty];
    const budgetMs = Math.min(settings.maxMs, budget.maxMs);
    const searchLocally = (): GameAction | null => {
      if (budget.signal?.aborted) return null;
      const action = searchMachineAction(state, {
        depth: settings.depth,
        budgetMs: Math.min(budgetMs, MAIN_THREAD_MAX_MS),
        ...choiceOptions,
        onProgress: budget.onProgress,
        ...(modelBytes ? { evaluate: createNeuralEvaluator(modelBytes) } : {}),
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
        worker.postMessage({
          id,
          state,
          depth: settings.depth,
          budgetMs,
          ...choiceOptions,
          ...(modelBytes ? { modelBytes } : {}),
        });
      } catch {
        onError();
      }
    });
  }

  dispose(): void {
    this.#operation += 1;
    this.#cancelSearch?.();
    this.#worker?.terminate();
    this.#worker = null;
  }
}

type WorkerResponse =
  | { id: number; type: 'progress'; metadata: SearchMetadata }
  | { id: number; type: 'result'; action: GameAction | null; metadata: SearchMetadata };
