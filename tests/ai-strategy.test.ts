import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ai from '../src/ai';
import { WorkerAiStrategy, difficultyBudget } from '../src/ai-strategy';
import { createGameState } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import type { GameAction } from '../src/types';

const action: GameAction = {
  kind: 'move',
  pieceId: 'machine-long',
  to: { q: 0, r: 1 },
};
const metadata: ai.SearchMetadata = {
  requestedDepth: 7,
  completedDepth: 2,
  nodes: 150,
  elapsedMs: 100,
  timedOut: true,
  score: 10,
  candidatesConsidered: 30,
};

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  static failPost = false;
  postMessage = vi.fn<(message: unknown) => void>(() => {
    if (FakeWorker.failPost) throw new Error('Could not send position');
  });
  terminate = vi.fn();

  constructor() {
    super();
    FakeWorker.instances.push(this);
  }

  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error('The strategy did not start a Worker');
  return worker;
}

function position() {
  return createGameState(
    [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-long', type: 'long', owner: 1, position: { q: 0, r: 2 } },
    ],
    1,
  );
}

describe('Worker AI strategy', () => {
  let strategy: WorkerAiStrategy;

  beforeEach(() => {
    strategy = new WorkerAiStrategy();
    FakeWorker.instances = [];
    FakeWorker.failPost = false;
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(ai, 'chooseMachineAction').mockReturnValue(action);
    vi.spyOn(ai, 'searchMachineAction').mockReturnValue(action);
  });

  afterEach(() => {
    strategy.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['recruit', 'tactical', 'commander', 'expert', 'neural'] as const)(
    'does no work for an already aborted %s request',
    async (difficulty) => {
      const controller = new AbortController();
      controller.abort();
      const config = createClassicConfig({ mode: 'machine', difficulty });

      await expect(
        strategy.chooseAction(position(), config, { maxMs: 100, signal: controller.signal }),
      ).resolves.toBeNull();

      expect(ai.chooseMachineAction).not.toHaveBeenCalled();
      expect(ai.searchMachineAction).not.toHaveBeenCalled();
      expect(FakeWorker.instances).toHaveLength(0);
    },
  );

  it.each([
    ['recruit', 250, 1],
    ['tactical', 2_000, 3],
    ['commander', 5_000, 5],
    ['expert', 15_000, 9],
  ] as const)(
    'uses the increased %s budget for a bounded Worker search',
    async (difficulty, maxMs, depth) => {
      expect(difficultyBudget(difficulty)).toBe(maxMs);
      const config = createClassicConfig({ mode: 'machine', difficulty, seed: 17 });
      const pending = strategy.chooseAction(position(), config, { maxMs: 30_000 });
      const worker = lastWorker();
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          difficulty,
          budgetMs: maxMs,
          depth,
          seed: 17,
        }),
      );
      worker.message({ id: 1, type: 'result', action, metadata });
      await expect(pending).resolves.toEqual(action);
      expect(ai.chooseMachineAction).not.toHaveBeenCalled();
    },
  );

  it('passes the match draw rules and available budget to the Recruit Worker', async () => {
    const config = createClassicConfig({
      mode: 'machine',
      difficulty: 'recruit',
      noProgressPlyLimit: 60,
    });
    config.victory.repetition = 0;

    const pending = strategy.chooseAction(position(), config, { maxMs: 120 });
    const worker = lastWorker();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        depth: 1,
        budgetMs: 120,
        resolutionRules: { repetition: null, noProgressPlyLimit: 60, orientationOnlyTurnLimit: 5 },
      }),
    );
    worker.message({ id: 1, type: 'result', action, metadata });
    await expect(pending).resolves.toEqual(action);
  });

  it('sends the difficulty, available budget and match rules to the Worker', async () => {
    const config = createClassicConfig({
      mode: 'machine',
      difficulty: 'expert',
      seed: 42,
      noProgressPlyLimit: 160,
    });
    const state = position();
    const onProgress = vi.fn();
    const pending = strategy.chooseAction(state, config, { maxMs: 75, onProgress });
    const worker = lastWorker();

    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 1,
      state,
      depth: 9,
      budgetMs: 75,
      difficulty: 'expert',
      personality: 'balanced',
      seed: 42,
      resolutionRules: { repetition: null, noProgressPlyLimit: 160, orientationOnlyTurnLimit: 5 },
    });
    worker.message({ id: 99, type: 'progress', metadata });
    expect(onProgress).not.toHaveBeenCalled();
    worker.message({ id: 1, type: 'progress', metadata });
    expect(onProgress).toHaveBeenCalledWith(metadata);
    worker.message({ id: 1, type: 'result', action, metadata });

    await expect(pending).resolves.toEqual(action);
    expect(worker.terminate).toHaveBeenCalled();
    expect(ai.searchMachineAction).not.toHaveBeenCalled();
  });

  it('sends an explicit experimental model without transferring or retaining caller memory', async () => {
    const bytes = new Uint8Array([72, 88, 78, 78]).buffer;
    strategy.dispose();
    strategy = new WorkerAiStrategy(bytes);
    new Uint8Array(bytes)[0] = 0;
    const config = createClassicConfig({ mode: 'machine', difficulty: 'expert' });
    const pending = strategy.chooseAction(position(), config, { maxMs: 100 });
    const worker = lastWorker();
    const request = worker.postMessage.mock.calls[0][0] as { modelBytes: ArrayBuffer };
    expect(request.modelBytes).not.toBe(bytes);
    expect([...new Uint8Array(request.modelBytes)]).toEqual([72, 88, 78, 78]);
    worker.message({ id: 1, type: 'result', action, metadata });
    await expect(pending).resolves.toEqual(action);
  });

  it('rejects an incompatible candidate before constructing a strategy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
    );
    await expect(WorkerAiStrategy.createNeuralCandidate()).rejects.toThrow('Cabecera');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('loads Neuronal once, uses Expert limits and keeps subsequent Expert turns classical', async () => {
    const file = readFileSync(new URL('../src/ai-models/hex-value.bin', import.meta.url));
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const fetchModel = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
    vi.stubGlobal('fetch', fetchModel);
    const config = createClassicConfig({ mode: 'machine', difficulty: 'neural' });
    expect(difficultyBudget('neural')).toBe(15_000);
    for (const [index, difficulty] of ['neural', 'expert', 'neural'].entries()) {
      config.participants[1].difficulty = difficulty as 'neural' | 'expert';
      const pending = strategy.chooseAction(position(), config, { maxMs: 30_000 });
      await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(index + 1));
      const worker = lastWorker();
      const request = worker.postMessage.mock.calls[0][0] as { modelBytes?: ArrayBuffer };
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          depth: 9,
          budgetMs: 15_000,
          difficulty: 'expert',
        }),
      );
      if (difficulty === 'neural') expect(request.modelBytes?.byteLength).toBe(bytes.byteLength);
      else expect(request.modelBytes).toBeUndefined();
      worker.message({ id: index + 1, type: 'result', action, metadata });
      await expect(pending).resolves.toEqual(action);
    }
    expect(fetchModel).toHaveBeenCalledTimes(1);
  });

  it('announces a failed model load and plays a classical Expert turn', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const onFallback = vi.fn();
    const config = createClassicConfig({ mode: 'machine', difficulty: 'neural' });
    const pending = strategy.chooseAction(position(), config, { maxMs: 100, onFallback });
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining('Experto jugará este turno'));
    expect(lastWorker().postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: 'expert' }),
    );
    expect(lastWorker().postMessage.mock.calls[0][0]).not.toHaveProperty('modelBytes');
    lastWorker().message({ id: 1, type: 'result', action, metadata });
    await expect(pending).resolves.toEqual(action);
  });

  it.each(['abort', 'dispose'] as const)(
    'does not create a Worker after %s during model loading',
    async (cancel) => {
      let finishFetch!: (response: { ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }) => void;
      const fetchModel = vi.fn(
        () =>
          new Promise((resolve) => {
            finishFetch = resolve;
          }),
      );
      vi.stubGlobal('fetch', fetchModel);
      const controller = new AbortController();
      const onFallback = vi.fn();
      const config = createClassicConfig({ mode: 'machine', difficulty: 'neural' });
      const pending = strategy.chooseAction(position(), config, {
        maxMs: 100,
        signal: controller.signal,
        onFallback,
      });
      if (cancel === 'abort') controller.abort();
      else strategy.dispose();
      const options = fetchModel.mock.calls[0] as unknown as [URL, RequestInit];
      expect(options[1].signal?.aborted).toBe(true);
      finishFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
      await expect(pending).resolves.toBeNull();
      expect(FakeWorker.instances).toHaveLength(0);
      expect(onFallback).not.toHaveBeenCalled();
    },
  );

  it('settles and terminates an aborted search and ignores late messages', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const config = createClassicConfig({ mode: 'machine', difficulty: 'expert' });
    const pending = strategy.chooseAction(position(), config, {
      maxMs: 5_000,
      signal: controller.signal,
      onProgress,
    });
    const worker = lastWorker();
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(worker.terminate).toHaveBeenCalled();
    worker.message({ id: 1, type: 'result', action, metadata });
    worker.dispatchEvent(new Event('error'));
    expect(onProgress).not.toHaveBeenCalled();
    expect(ai.searchMachineAction).not.toHaveBeenCalled();
  });

  it('resolves the pending promise when disposed without an AbortSignal', async () => {
    const config = createClassicConfig({ mode: 'machine', difficulty: 'commander' });
    const pending = strategy.chooseAction(position(), config, { maxMs: 2_500 });
    const worker = lastWorker();

    strategy.dispose();

    await expect(pending).resolves.toBeNull();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('cancels the previous search when another request starts', async () => {
    const config = createClassicConfig({ mode: 'machine', difficulty: 'tactical' });
    const previous = strategy.chooseAction(position(), config, { maxMs: 900 });
    const previousWorker = lastWorker();
    const current = strategy.chooseAction(position(), config, { maxMs: 900 });
    const currentWorker = lastWorker();

    await expect(previous).resolves.toBeNull();
    expect(previousWorker.terminate).toHaveBeenCalled();
    expect(currentWorker.terminate).not.toHaveBeenCalled();
    currentWorker.message({ id: 2, type: 'result', action, metadata });
    await expect(current).resolves.toEqual(action);
  });

  it.each(['unavailable', 'constructor', 'runtime', 'messageerror', 'postMessage'] as const)(
    'keeps the 15-second Expert profile in a bounded fallback after %s failure',
    async (failure) => {
      if (failure === 'unavailable') vi.stubGlobal('Worker', undefined);
      if (failure === 'constructor') {
        vi.stubGlobal(
          'Worker',
          class {
            constructor() {
              throw new Error('Workers unavailable');
            }
          },
        );
      }
      FakeWorker.failPost = failure === 'postMessage';
      const config = createClassicConfig({
        mode: 'machine',
        difficulty: 'expert',
        seed: 81,
        noProgressPlyLimit: null,
      });
      const onProgress = vi.fn();
      const pending = strategy.chooseAction(position(), config, {
        maxMs: difficultyBudget('expert'),
        onProgress,
      });
      if (failure === 'runtime') lastWorker().dispatchEvent(new Event('error'));
      if (failure === 'messageerror') lastWorker().dispatchEvent(new Event('messageerror'));

      await expect(pending).resolves.toEqual(action);
      expect(ai.searchMachineAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          depth: 9,
          budgetMs: 400,
          difficulty: 'expert',
          seed: 81,
          resolutionRules: {
            repetition: null,
            noProgressPlyLimit: null,
            orientationOnlyTurnLimit: 5,
          },
          onProgress,
        }),
      );
      expect(ai.chooseMachineAction).not.toHaveBeenCalled();
      for (const worker of FakeWorker.instances) expect(worker.terminate).toHaveBeenCalled();
    },
  );

  it('respects a shorter fallback budget and cancellation during progress', async () => {
    vi.stubGlobal('Worker', undefined);
    const controller = new AbortController();
    const onProgress = (): void => controller.abort();
    vi.mocked(ai.searchMachineAction).mockImplementation((_state, options) => {
      options.onProgress?.(metadata);
      return action;
    });
    const config = createClassicConfig({ mode: 'machine', difficulty: 'expert' });

    await expect(
      strategy.chooseAction(position(), config, {
        maxMs: 50,
        signal: controller.signal,
        onProgress,
      }),
    ).resolves.toBeNull();
    expect(ai.searchMachineAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ budgetMs: 50 }),
    );
  });

  it('the Worker forwards the configured rules into its search', async () => {
    const scope = Object.assign(new EventTarget(), { postMessage: vi.fn() });
    vi.stubGlobal('self', scope);
    const search = vi
      .spyOn(ai, 'searchMachineActionWithMetadata')
      .mockImplementation((_state, options) => {
        options.onProgress?.(metadata);
        return { action, metadata };
      });
    await import('../src/ai-worker');
    const request = {
      id: 12,
      state: position(),
      depth: 5,
      budgetMs: 2_000,
      difficulty: 'commander',
      personality: 'balanced',
      seed: 3,
      resolutionRules: { repetition: null, noProgressPlyLimit: 60, orientationOnlyTurnLimit: 5 },
    };

    scope.dispatchEvent(new MessageEvent('message', { data: request }));

    expect(search).toHaveBeenCalledWith(
      request.state,
      expect.objectContaining({
        depth: 5,
        budgetMs: 2_000,
        difficulty: 'commander',
        resolutionRules: request.resolutionRules,
      }),
    );
    expect(scope.postMessage).toHaveBeenCalledWith({ id: 12, type: 'progress', metadata });
    expect(scope.postMessage).toHaveBeenCalledWith({ id: 12, type: 'result', action, metadata });
  });
});
