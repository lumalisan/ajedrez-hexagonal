import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameState } from '../src/engine';
import { BoardRenderer, type RenderModel } from '../src/renderer';
import type { BoardAnimation } from '../src/rendering/pixi-board';

interface SceneProbe {
  render(): void;
  update(idleTime: number | undefined, animation: BoardAnimation | null): void;
}

const rendering = vi.hoisted(() => ({
  canvases: new WeakMap<HTMLCanvasElement, SceneProbe>(),
  stages: new WeakMap<object, SceneProbe>(),
}));

// Exercise BoardRenderer's real timing/visibility/camera logic without creating a GPU context.
// PixiSurface initialization and piece transforms have separate focused tests.
vi.mock('../src/rendering/pixi-surface', () => ({
  PixiSurface: class {
    readonly stage = {};
    readonly ready = Promise.resolve();
    initialized = true;
    private readonly probe: SceneProbe;
    constructor(canvas: HTMLCanvasElement) {
      const probe = rendering.canvases.get(canvas);
      if (!probe) throw new Error('Missing render probe');
      this.probe = probe;
      rendering.stages.set(this.stage, probe);
    }
    resize(): void {}
    render(): void {
      this.probe.render();
    }
    destroy(): void {
      this.initialized = false;
    }
  },
}));

vi.mock('../src/rendering/pixi-board', () => ({
  PixiBoard: class {
    private readonly probe: SceneProbe;
    constructor(stage: object) {
      const probe = rendering.stages.get(stage);
      if (!probe) throw new Error('Missing scene probe');
      this.probe = probe;
    }
    update(
      _model: RenderModel | null,
      _time: number,
      view: { idleTime?: number },
      animation: BoardAnimation | null,
    ): void {
      this.probe.update(view.idleTime, animation);
    }
    destroy(): void {}
  },
}));

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  get hidden(): boolean {
    return this.visibilityState === 'hidden';
  }

  setVisible(visible: boolean): void {
    this.visibilityState = visible ? 'visible' : 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

class FakeMotionPreference extends EventTarget {
  matches = false;

  setReduced(reduced: boolean): void {
    this.matches = reduced;
    this.dispatchEvent(new Event('change'));
  }
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  setVisible(visible: boolean): void {
    this.callback(
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();

  constructor() {
    FakeResizeObserver.instances.push(this);
  }
}

function idleModel(): RenderModel {
  return {
    state: createGameState([
      { id: 'blue-fort', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'amber-fort', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'blue-drone', type: 'drone', owner: 0, position: { q: 0, r: 0 } },
    ]),
    fortressMaxHp: [2, 2],
    selectedId: null,
    actions: [],
    pending: null,
    hovered: null,
    focused: null,
    firingRange: [],
    lastEvents: [],
    threatenedCells: [],
    reducedMotion: false,
    highContrast: false,
    idleAnimations: true,
  };
}

function createCanvasProbe() {
  const draw = vi.fn();
  let idleTime: number | undefined;
  let animation: BoardAnimation | null = null;
  const canvas = {
    dataset: {},
    isConnected: true,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 900, height: 700 }),
  } as unknown as HTMLCanvasElement;
  rendering.canvases.set(canvas, {
    render: draw,
    update(nextTime, nextAnimation) {
      idleTime = nextTime;
      animation = nextAnimation;
    },
  });
  return {
    canvas,
    clearCanvas: draw,
    idleTime: () => idleTime,
    animation: () => animation,
  };
}

describe('ciclo de vida de las animaciones idle', () => {
  let renderer: BoardRenderer;
  let document: FakeDocument;
  let motion: FakeMotionPreference;
  let intersection: FakeIntersectionObserver;
  let frames: Map<number, FrameRequestCallback>;
  let clearCanvas: ReturnType<typeof vi.fn>;
  let canvasProbe: ReturnType<typeof createCanvasProbe>;
  let referenceRenderers: BoardRenderer[];
  let time: number;

  // Run only currently queued callbacks, like a browser refresh. Newly requested frames
  // remain pending so tests can distinguish a live loop from a final static redraw.
  function refresh(elapsed = 40): void {
    time += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }

  function idleReference(model: RenderModel = idleModel()) {
    const probe = createCanvasProbe();
    const reference = new BoardRenderer(probe.canvas);
    referenceRenderers.push(reference);
    reference.setModel(model);
    FakeIntersectionObserver.instances.at(-1)?.setVisible(true);
    return probe;
  }

  beforeEach(() => {
    frames = new Map();
    let nextFrame = 0;
    time = 0;
    referenceRenderers = [];
    document = new FakeDocument();
    motion = new FakeMotionPreference();
    FakeIntersectionObserver.instances = [];
    FakeResizeObserver.instances = [];
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => motion });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    canvasProbe = createCanvasProbe();
    clearCanvas = canvasProbe.clearCanvas;
    renderer = new BoardRenderer(canvasProbe.canvas);
    intersection = FakeIntersectionObserver.instances[0];
    renderer.setModel(idleModel());
    intersection.setVisible(true);
  });

  afterEach(() => {
    renderer?.destroy();
    for (const reference of referenceRenderers) reference.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mantiene el repintado sin selección ni acciones mientras hay piezas idle', () => {
    refresh();
    const firstDraws = clearCanvas.mock.calls.length;
    refresh();
    refresh();
    expect(clearCanvas.mock.calls.length).toBeGreaterThan(firstDraws);
    expect(frames.size).toBe(1);
  });

  it('conserva la pose idle mientras otra pieza se mueve', () => {
    const before = idleModel();
    const from = { q: 1, r: 0 };
    const to = { q: 1, r: 1 };
    before.state.pieces.push({
      id: 'blue-soldier',
      type: 'soldier',
      owner: 0,
      position: from,
      facing: 3,
    });
    const reference = idleReference();
    renderer.setModel(before);
    refresh();
    const initialPhase = canvasProbe.idleTime();
    expect(initialPhase).toBe(time);

    renderer.setModel({
      ...before,
      state: {
        ...before.state,
        pieces: before.state.pieces.map((piece) =>
          piece.id === 'blue-soldier' ? { ...piece, position: to } : piece,
        ),
      },
    });
    void renderer.playEvents(
      [{ type: 'move', pieceId: 'blue-soldier', from, to }],
      before.state,
      false,
    );

    for (let frame = 0; frame < 3; frame += 1) {
      refresh();
      expect(canvasProbe.animation()).not.toBeNull();
      expect(canvasProbe.idleTime()).toBe(reference.idleTime());
      expect(canvasProbe.idleTime()).not.toBe(initialPhase);
    }
  });

  it('mantiene la misma fase idle al iniciar, mover y terminar el vuelo del propio dron', async () => {
    const before = idleModel();
    const from = { q: 0, r: 0 };
    const to = { q: 1, r: 0 };
    const reference = idleReference();
    refresh();
    const initialPhase = canvasProbe.idleTime();
    expect(initialPhase).toBe(time);
    renderer.setModel({
      ...before,
      state: {
        ...before.state,
        pieces: before.state.pieces.map((piece) =>
          piece.id === 'blue-drone' ? { ...piece, position: to } : piece,
        ),
      },
    });
    const finished = vi.fn();
    void renderer
      .playEvents([{ type: 'move', pieceId: 'blue-drone', from, to }], before.state, false)
      .then(finished);

    refresh(0);
    expect(canvasProbe.idleTime()).toBe(initialPhase);
    for (let frame = 0; frame < 10; frame += 1) {
      refresh();
      expect(canvasProbe.idleTime()).toBe(reference.idleTime());
      expect(canvasProbe.idleTime()).not.toBe(initialPhase);
      await Promise.resolve();
    }
    expect(finished).toHaveBeenCalledOnce();
    expect(frames.size).toBe(2);
  });

  it('conserva la fase idle durante y después del giro de cámara', async () => {
    const reference = idleReference();
    refresh();
    const initialPhase = canvasProbe.idleTime();
    expect(initialPhase).toBe(time);
    const finished = vi.fn();
    void renderer.rotateToPlayer(1, false).then(finished);

    refresh(0);
    expect(canvasProbe.idleTime()).toBe(initialPhase);
    for (let frame = 0; frame < 20; frame += 1) {
      refresh();
      expect(canvasProbe.idleTime()).toBe(reference.idleTime());
      expect(canvasProbe.idleTime()).not.toBe(initialPhase);
      await Promise.resolve();
    }
    expect(finished).toHaveBeenCalledOnce();
    expect(frames.size).toBe(2);
  });

  it.each([false, undefined])(
    'no mantiene un bucle cuando idleAnimations es %s',
    (idleAnimations) => {
      renderer.setModel({ ...idleModel(), idleAnimations });
      refresh();
      expect(frames.size).toBe(0);
    },
  );

  it('anima un movimiento y mantiene los rotores en reposo con el idle desactivado', async () => {
    const before = { ...idleModel(), idleAnimations: false };
    const from = { q: 0, r: 0 };
    const to = { q: 1, r: 0 };
    renderer.setModel(before);
    refresh();
    expect(canvasProbe.idleTime()).toBeUndefined();
    expect(frames.size).toBe(0);

    renderer.setModel({
      ...before,
      state: {
        ...before.state,
        pieces: before.state.pieces.map((piece) =>
          piece.id === 'blue-drone' ? { ...piece, position: to } : piece,
        ),
      },
    });
    const finished = vi.fn();
    void renderer
      .playEvents([{ type: 'move', pieceId: 'blue-drone', from, to }], before.state, false)
      .then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();

    refresh();
    expect(frames.size).toBe(1);
    expect(canvasProbe.idleTime()).toBeUndefined();
    expect(canvasProbe.animation()).not.toBeNull();
    const draws = clearCanvas.mock.calls.length;
    refresh();
    expect(clearCanvas.mock.calls.length).toBeGreaterThan(draws);
    expect(canvasProbe.idleTime()).toBeUndefined();
    expect(finished).not.toHaveBeenCalled();

    for (let frame = 0; frame < 20; frame += 1) refresh();
    await Promise.resolve();
    expect(finished).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(canvasProbe.idleTime()).toBeUndefined();
  });

  it('detiene el idle con la preferencia de movimiento reducido y vuelve al desactivarla', () => {
    refresh();
    renderer.setModel({ ...idleModel(), reducedMotion: true });
    refresh();
    expect(frames.size).toBe(0);
    const draws = clearCanvas.mock.calls.length;
    refresh();
    expect(clearCanvas).toHaveBeenCalledTimes(draws);

    renderer.setModel(idleModel());
    refresh();
    expect(frames.size).toBe(1);
    expect(clearCanvas.mock.calls.length).toBeGreaterThan(draws);
  });

  it('responde a cambios de la preferencia de movimiento reducido del sistema', () => {
    refresh();
    motion.setReduced(true);
    refresh();
    expect(frames.size).toBe(0);

    motion.setReduced(false);
    refresh();
    expect(frames.size).toBe(1);
  });

  it('suspende el idle fuera de pantalla y lo reanuda al volver', () => {
    refresh();
    intersection.setVisible(false);
    refresh();
    expect(frames.size).toBe(0);
    const draws = clearCanvas.mock.calls.length;
    refresh();
    expect(clearCanvas).toHaveBeenCalledTimes(draws);

    intersection.setVisible(true);
    refresh();
    expect(frames.size).toBe(1);
    expect(clearCanvas.mock.calls.length).toBeGreaterThan(draws);
  });

  it('suspende el idle en una pestaña oculta y lo reanuda al regresar', () => {
    refresh();
    document.setVisible(false);
    refresh();
    expect(frames.size).toBe(0);

    document.setVisible(true);
    refresh();
    expect(frames.size).toBe(1);
  });

  it('completa un giro pendiente al ocultarse sin dejar la partida esperando', async () => {
    refresh();
    const finished = vi.fn();
    void renderer.rotateToPlayer(1, false).then(finished);
    document.setVisible(false);
    for (let frame = 0; frame < 25; frame += 1) refresh();
    await Promise.resolve();

    expect(finished).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('libera observadores y listeners y no vuelve a programar frames tras destruirse', () => {
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const removeMotionListener = vi.spyOn(motion, 'removeEventListener');
    refresh();
    renderer.destroy();
    expect(frames.size).toBe(0);
    expect(intersection.disconnect).toHaveBeenCalledOnce();
    expect(FakeResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeMotionListener).toHaveBeenCalledWith('change', expect.any(Function));

    document.setVisible(false);
    document.setVisible(true);
    motion.setReduced(true);
    motion.setReduced(false);
    intersection.setVisible(false);
    intersection.setVisible(true);
    renderer.setModel(idleModel());
    expect(frames.size).toBe(0);
  });
});
