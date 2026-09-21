import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRuleDemo } from '../src/rules-demo';
import type { Hex } from '../src/types';

const renderer = vi.hoisted(() => ({
  setDepthMode: vi.fn(),
  snapToPlayer: vi.fn(),
  setFrame: vi.fn<(positions: readonly Hex[]) => void>(),
  setModel: vi.fn(),
  playEvents: vi.fn(async () => undefined),
  destroy: vi.fn(),
}));

vi.mock('../src/renderer', () => ({
  BoardRenderer: class {
    setDepthMode = renderer.setDepthMode;
    snapToPlayer = renderer.snapToPlayer;
    setFrame = renderer.setFrame;
    setModel = renderer.setModel;
    playEvents = renderer.playEvents;
    destroy = renderer.destroy;
  },
}));

const observer = { observe: vi.fn(), disconnect: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observer.observe;
      disconnect = observer.disconnect;
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createCanvas(): HTMLCanvasElement {
  const attributes = new Map([['aria-label', 'Vista original']]);
  return {
    dataset: {},
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  } as unknown as HTMLCanvasElement;
}

describe('ciclo de vida de las demostraciones controladas por React', () => {
  it('centra cada animación de Fortaleza y Escudo sin mover la cámara entre sus pasos', () => {
    const demo = mountRuleDemo(createCanvas(), 'fortaleza', {
      reducedMotion: true,
      highContrast: false,
    });
    const fortressFrame = renderer.setFrame.mock.lastCall?.[0];
    expect(fortressFrame).toEqual(
      expect.arrayContaining([
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 0, r: 4 },
      ]),
    );
    expect(fortressFrame?.every(({ q, r }) => q === 0 && r < 5)).toBe(true);

    demo.advanceStep();
    demo.advanceStep();
    demo.advanceStep();
    expect(renderer.setFrame).toHaveBeenCalledTimes(1);
    demo.advanceStep();
    expect(renderer.setFrame).toHaveBeenCalledTimes(2);
    expect(renderer.setFrame.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([
        { q: 3, r: 2 },
        { q: 0, r: 5 },
      ]),
    );
    expect(renderer.setFrame.mock.lastCall?.[0]).not.toContainEqual({ q: 0, r: 4 });

    demo.restart();
    expect(renderer.setFrame.mock.lastCall?.[0]).toEqual(fortressFrame);
    demo.destroy();
  });

  it('selecciona el destino previsto del Dron antes de reproducir la intercepción del motor', async () => {
    const demo = mountRuleDemo(createCanvas(), 'fortaleza', {
      reducedMotion: false,
      highContrast: false,
    });
    for (let step = 0; step < 4; step += 1) demo.advanceStep();
    demo.togglePlayback();
    await vi.advanceTimersByTimeAsync(1_700);
    expect(renderer.setModel.mock.lastCall?.[0]).toMatchObject({
      pending: { kind: 'move', to: { q: 1, r: 4 } },
      pendingDestination: { q: 0, r: 5 },
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(renderer.playEvents).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'intercept', at: { q: 1, r: 4 } })]),
      expect.anything(),
      false,
      2,
    );
    expect(renderer.setModel.mock.lastCall?.[0].pendingDestination).toBeUndefined();
    demo.destroy();
  });

  it('permite pausar, avanzar y reiniciar mediante su API sin buscar controles DOM', () => {
    const onSceneChange = vi.fn();
    const onPlaybackChange = vi.fn();
    const demo = mountRuleDemo(createCanvas(), 'capturador', {
      reducedMotion: false,
      highContrast: false,
      onSceneChange,
      onPlaybackChange,
    });

    expect(onPlaybackChange).toHaveBeenLastCalledWith(false, false);
    expect(vi.getTimerCount()).toBe(1);
    demo.togglePlayback();
    expect(onPlaybackChange).toHaveBeenLastCalledWith(true, false);
    expect(vi.getTimerCount()).toBe(0);

    demo.advanceStep();
    demo.advanceStep();
    expect(onSceneChange.mock.lastCall?.slice(1)).toEqual([1, 3]);
    demo.restart();
    expect(onSceneChange.mock.lastCall?.slice(1)).toEqual([0, 3]);
    demo.destroy();
  });

  it('libera recursos al desmontar y admite el remontaje de efectos en el mismo canvas', () => {
    const canvas = createCanvas();
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const options = { reducedMotion: false, highContrast: false };
    const demo = mountRuleDemo(canvas, 'soldado', options);
    expect(canvas.getAttribute('aria-label')).not.toBe('Vista original');
    demo.destroy();
    demo.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(canvas.getAttribute('aria-label')).toBe('Vista original');

    const renderCount = renderer.setModel.mock.calls.length;
    demo.advanceStep();
    demo.togglePlayback();
    demo.restart();
    expect(renderer.setModel).toHaveBeenCalledTimes(renderCount);

    const remounted = mountRuleDemo(canvas, 'soldado', options);
    expect(vi.getTimerCount()).toBe(1);
    remounted.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(renderer.destroy).toHaveBeenCalledTimes(2);
  });

  it('mantiene los pasos manuales con movimiento reducido y bloquea la reproducción automática', () => {
    const onPlaybackChange = vi.fn();
    const onSceneChange = vi.fn();
    const demo = mountRuleDemo(createCanvas(), 'soldado', {
      reducedMotion: true,
      highContrast: false,
      onPlaybackChange,
      onSceneChange,
    });
    demo.togglePlayback();
    expect(onPlaybackChange).toHaveBeenCalledTimes(1);
    expect(onPlaybackChange).toHaveBeenLastCalledWith(true, true);
    expect(vi.getTimerCount()).toBe(0);
    demo.advanceStep();
    demo.advanceStep();
    expect(onSceneChange.mock.lastCall?.slice(1)).toEqual([1, 3]);
    demo.destroy();
  });
});
