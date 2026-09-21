import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as ai from '../src/ai';
import { WorkerAiStrategy } from '../src/ai-strategy';
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

  it.each(['recruit', 'tactical', 'commander', 'expert'] as const)(
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

  it('passes the match draw rules to the Recruit evaluation', async () => {
    const config = createClassicConfig({
      mode: 'machine',
      difficulty: 'recruit',
      noProgressPlyLimit: 60,
    });
    config.victory.repetition = 0;

    await strategy.chooseAction(position(), config, { maxMs: 120 });

    expect(ai.chooseMachineAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolutionRules: { repetition: null, noProgressPlyLimit: 60 } }),
    );
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
      depth: 7,
      budgetMs: 75,
      difficulty: 'expert',
      personality: 'balanced',
      seed: 42,
      resolutionRules: { repetition: 3, noProgressPlyLimit: 160 },
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
    'keeps Expert search and match rules in a bounded fallback after %s failure',
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
      const pending = strategy.chooseAction(position(), config, { maxMs: 5_000, onProgress });
      if (failure === 'runtime') lastWorker().dispatchEvent(new Event('error'));
      if (failure === 'messageerror') lastWorker().dispatchEvent(new Event('messageerror'));

      await expect(pending).resolves.toEqual(action);
      expect(ai.searchMachineAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          depth: 7,
          budgetMs: 400,
          difficulty: 'expert',
          seed: 81,
          resolutionRules: { repetition: 3, noProgressPlyLimit: null },
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
      resolutionRules: { repetition: null, noProgressPlyLimit: 60 },
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
