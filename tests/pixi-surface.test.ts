import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiSurface } from '../src/rendering/pixi-surface';

type FunctionMock = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;

interface FakeApplication {
  stage: { eventMode: string; interactiveChildren: boolean; destroy: FunctionMock };
  renderer: {
    name: string;
    resize: FunctionMock;
    destroy: FunctionMock;
    events: { autoPreventDefault: boolean };
    gl?: WebGL2RenderingContext;
  };
  init: FunctionMock;
  render: FunctionMock;
  destroy: FunctionMock;
  resolveInit: (gl?: WebGL2RenderingContext) => void;
  rejectInit: (error: unknown) => void;
}

const pixi = vi.hoisted(() => ({
  applications: [] as FakeApplication[],
  operations: [] as string[],
  stopSystem: vi.fn(),
  releaseGlobal: vi.fn(),
}));

vi.mock('pixi.js', () => ({
  Application: class implements FakeApplication {
    stage = { eventMode: 'auto', interactiveChildren: true, destroy: vi.fn() };
    renderer!: FakeApplication['renderer'];
    resolveInit: FakeApplication['resolveInit'] = () => undefined;
    rejectInit: FakeApplication['rejectInit'] = () => undefined;
    private readonly id = pixi.applications.length;
    init = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          pixi.operations.push(`init:${this.id}`);
          this.resolveInit = (gl) => {
            this.renderer = {
              name: 'webgl',
              resize: vi.fn(),
              destroy: vi.fn(),
              events: { autoPreventDefault: true },
              ...(gl ? { gl } : {}),
            };
            resolve();
          };
          this.rejectInit = reject;
        }),
    );
    render = vi.fn();
    destroy = vi.fn(() => {
      pixi.operations.push(`destroy:${this.id}`);
      this.stage.destroy();
      this.renderer.destroy();
      this.renderer.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    constructor() {
      pixi.applications.push(this);
    }
  },
  Ticker: { system: { stop: pixi.stopSystem } },
  GlobalResourceRegistry: { release: pixi.releaseGlobal },
}));

class FakeCanvas extends EventTarget {
  dataset: DOMStringMap = {};
}

describe('superficie Pixi asíncrona', () => {
  let surfaces: PixiSurface[];
  const surface = (canvas = new FakeCanvas(), onReady = vi.fn(), onError = vi.fn()) => {
    const instance = new PixiSurface(canvas as unknown as HTMLCanvasElement, onReady, onError);
    surfaces.push(instance);
    return instance;
  };
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  beforeEach(() => {
    surfaces = [];
    pixi.applications.length = 0;
    pixi.operations.length = 0;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    for (const instance of surfaces) instance.destroy();
    for (const application of pixi.applications) application.resolveInit();
    await Promise.all(surfaces.map((instance) => instance.ready));
    vi.useRealTimers();
  });

  it('expone el stage de inmediato y sólo renderiza por demanda tras inicializar', async () => {
    const canvas = new FakeCanvas();
    const onReady = vi.fn();
    const readyEvent = vi.fn();
    canvas.addEventListener('rendererready', readyEvent);
    const instance = surface(canvas, onReady);
    const app = pixi.applications[0];
    expect(instance.stage).toBe(app.stage);
    expect(instance.stage.eventMode).toBe('none');
    expect(instance.initialized).toBe(false);
    expect(app.init).not.toHaveBeenCalled();
    instance.render();
    expect(app.render).not.toHaveBeenCalled();

    await flush();
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas,
        preference: ['webgl', 'canvas'],
        autoStart: false,
        sharedTicker: false,
        gcActive: false,
        preserveDrawingBuffer: true,
        eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      }),
    );
    app.resolveInit();
    await instance.ready;
    expect(instance.initialized).toBe(true);
    expect(canvas.dataset.rendererStatus).toBe('ready');
    expect(canvas.dataset.renderer).toBe('pixi-webgl');
    expect(onReady).toHaveBeenCalledOnce();
    expect(readyEvent).toHaveBeenCalledOnce();
    expect(pixi.stopSystem).toHaveBeenCalledOnce();
    expect(app.render).not.toHaveBeenCalled();
    instance.render();
    expect(app.render).toHaveBeenCalledOnce();
  });

  it('aplica el último resize recibido antes y durante la inicialización', async () => {
    const instance = surface();
    const app = pixi.applications[0];
    instance.resize(900, 700, 2);
    await flush();
    instance.resize(390, 420, 2.5);
    app.resolveInit();
    await instance.ready;
    expect(app.renderer.resize).toHaveBeenLastCalledWith(390, 420, 2.5);
    instance.resize(600, 400, 1.5);
    expect(app.renderer.resize).toHaveBeenLastCalledWith(600, 400, 1.5);
  });

  it('solicita repintado al restaurarse el contexto sin reactivar una superficie desmontada', async () => {
    const canvas = new FakeCanvas();
    const onReady = vi.fn();
    const instance = surface(canvas, onReady);
    await flush();
    pixi.applications[0].resolveInit();
    await instance.ready;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onReady).toHaveBeenCalledTimes(2);
    instance.destroy();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('cancela el primer montaje síncrono de StrictMode sin crear un contexto', async () => {
    const canvas = new FakeCanvas();
    const obsoleteReady = vi.fn();
    const obsolete = surface(canvas, obsoleteReady);
    obsolete.destroy();
    const active = surface(canvas);
    await flush();
    expect(pixi.applications[0].init).not.toHaveBeenCalled();
    expect(pixi.applications[0].stage.destroy).toHaveBeenCalledOnce();
    expect(pixi.applications[0].destroy).not.toHaveBeenCalled();
    expect(pixi.applications[1].init).toHaveBeenCalledOnce();
    pixi.applications[1].resolveInit();
    await active.ready;
    expect(obsoleteReady).not.toHaveBeenCalled();
    expect(canvas.dataset.rendererStatus).toBe('ready');
  });

  it('espera al init y destroy pendientes antes de reutilizar el mismo canvas', async () => {
    const canvas = new FakeCanvas();
    const obsoleteReady = vi.fn();
    const obsolete = surface(canvas, obsoleteReady);
    await flush();
    obsolete.destroy();
    const active = surface(canvas);
    await flush();
    expect(pixi.applications[1].init).not.toHaveBeenCalled();
    pixi.applications[0].resolveInit();
    await flush();
    expect(pixi.operations).toEqual(['init:0', 'destroy:0', 'init:1']);
    expect(obsoleteReady).not.toHaveBeenCalled();
    expect(canvas.dataset.rendererStatus).toBe('loading');
    pixi.applications[1].resolveInit();
    await active.ready;
    expect(active.initialized).toBe(true);
  });

  it('una generación cancelada en espera no permite saltarse al propietario anterior', async () => {
    const canvas = new FakeCanvas();
    const first = surface(canvas);
    await flush();
    const skipped = surface(canvas);
    skipped.destroy();
    const final = surface(canvas);
    await flush();
    expect(pixi.applications[2].init).not.toHaveBeenCalled();
    first.destroy();
    pixi.applications[0].resolveInit();
    await flush();
    expect(pixi.applications[1].init).not.toHaveBeenCalled();
    expect(pixi.applications[2].init).toHaveBeenCalledOnce();
    pixi.applications[2].resolveInit();
    await final.ready;
  });

  it('comunica un fallo de init y libera el stage sin rechazar ready', async () => {
    const canvas = new FakeCanvas();
    const onError = vi.fn();
    const errorEvent = vi.fn();
    canvas.addEventListener('renderererror', errorEvent);
    const instance = surface(canvas, vi.fn(), onError);
    await flush();
    const failure = new Error('GPU unavailable');
    pixi.applications[0].rejectInit(failure);
    await expect(instance.ready).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(errorEvent).toHaveBeenCalledOnce();
    expect(canvas.dataset.rendererStatus).toBe('error');
    expect(pixi.stopSystem).toHaveBeenCalledOnce();
    expect(instance.initialized).toBe(false);
    expect(pixi.applications[0].stage.destroy).toHaveBeenCalledOnce();
    expect(pixi.applications[0].destroy).not.toHaveBeenCalled();
  });

  it('ignora un fallo tardío de una generación desmontada y permite el nuevo montaje', async () => {
    const canvas = new FakeCanvas();
    const onError = vi.fn();
    const obsolete = surface(canvas, vi.fn(), onError);
    await flush();
    obsolete.destroy();
    const active = surface(canvas);
    pixi.applications[0].rejectInit(new Error('late failure'));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(canvas.dataset.rendererStatus).toBe('loading');
    pixi.applications[1].resolveInit();
    await active.ready;
    expect(active.initialized).toBe(true);
  });

  it('restaura WebGL después de su pérdida antes de reinicializar el canvas de React', async () => {
    const canvas = new FakeCanvas();
    let lost = false;
    let lossEvent: Event | undefined;
    const extension = {
      loseContext: vi.fn(() => {
        lost = true;
        queueMicrotask(() => {
          lossEvent = new Event('webglcontextlost', { cancelable: true });
          canvas.dispatchEvent(lossEvent);
        });
      }),
      restoreContext: vi.fn(),
    };
    const gl = {
      getExtension: () => extension,
      isContextLost: () => lost,
    } as unknown as WebGL2RenderingContext;
    const first = surface(canvas);
    await flush();
    pixi.applications[0].resolveInit(gl);
    await first.ready;
    first.destroy();
    const next = surface(canvas);
    await flush();
    expect(lossEvent?.defaultPrevented).toBe(true);
    expect(extension.restoreContext).toHaveBeenCalledOnce();
    expect(pixi.applications[1].init).not.toHaveBeenCalled();
    lost = false;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await flush();
    expect(pixi.applications[1].init).toHaveBeenCalledOnce();
    pixi.applications[1].resolveInit();
    await next.ready;
    expect(next.initialized).toBe(true);
  });

  it('preserva las otras superficies y sólo libera recursos globales al cerrar la última', async () => {
    const first = surface();
    const second = surface();
    await flush();
    for (const app of pixi.applications) app.resolveInit();
    await Promise.all([first.ready, second.ready]);
    first.destroy();
    first.destroy();
    expect(pixi.applications[0].destroy).toHaveBeenCalledExactlyOnceWith(
      { removeView: false, releaseGlobalResources: false },
      { children: true, context: true },
    );
    second.render();
    expect(pixi.applications[1].render).toHaveBeenCalledOnce();
    second.destroy();
    expect(pixi.applications[1].destroy).toHaveBeenCalledWith(
      { removeView: false, releaseGlobalResources: true },
      { children: true, context: true },
    );
    second.render();
    second.resize(10, 10, 1);
    expect(pixi.applications[1].render).toHaveBeenCalledOnce();
    expect(pixi.applications[1].renderer.resize).toHaveBeenCalledOnce();
  });
});
