import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRuleDemo } from '../src/rules-demo';

const renderer = vi.hoisted(() => ({
  setDepthMode: vi.fn(),
  snapToPlayer: vi.fn(),
  setFrame: vi.fn(),
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
