import { Application, GlobalResourceRegistry, Ticker, type Container } from 'pixi.js';

interface CanvasLease {
  released: Promise<void>;
}

interface ContextRecovery {
  restore(): Promise<void>;
}

const canvasLeases = new WeakMap<HTMLCanvasElement, CanvasLease>();
const contextRecoveries = new WeakMap<HTMLCanvasElement, ContextRecovery>();
const liveSurfaces = new Set<PixiSurface>();
// Gradients and non-shared textures belong to the scene; never destroy Pixi's shared Texture.WHITE.
const destroyChildren = { children: true, context: true };

/** Owns Pixi's WebGL/Canvas lifetime; BoardRenderer remains the only frame driver. */
export class PixiSurface {
  readonly ready: Promise<void>;
  readonly stage: Container;
  private readonly application = new Application();
  private readonly lease: CanvasLease;
  private readonly releaseLease: () => void;
  private size = { width: 1, height: 1, resolution: 1 };
  private initStarted = false;
  private initCompleted = false;
  private destroyed = false;
  private released = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onReady: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.stage = this.application.stage;
    this.stage.eventMode = 'none';
    this.stage.interactiveChildren = false;
    const previous = canvasLeases.get(canvas)?.released ?? Promise.resolve();
    let release!: () => void;
    const ownRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releaseLease = release;
    this.lease = { released: Promise.all([previous, ownRelease]).then(() => undefined) };
    canvasLeases.set(canvas, this.lease);
    canvas.dataset.rendererStatus = 'loading';
    liveSurfaces.add(this);

    // StrictMode's immediate cleanup runs before this microtask allocates a GPU context.
    this.ready = previous
      .then(() => this.initialize())
      .catch((error: unknown) => {
        // Renderer systems can start the shared ticker before init fails.
        // No surface uses it: stop that partial initialization's background loop too.
        Ticker.system.stop();
        if (!this.destroyed && canvasLeases.get(canvas) === this.lease) {
          canvas.dataset.rendererStatus = 'error';
          this.onError(error);
          canvas.dispatchEvent(new CustomEvent('renderererror', { detail: error }));
        }
        this.destroyed = true;
        this.releaseResources();
      });
  }

  get initialized(): boolean {
    return this.initCompleted && !this.destroyed;
  }

  resize(width: number, height: number, resolution: number): void {
    if (this.destroyed) return;
    this.size = { width: Math.max(1, width), height: Math.max(1, height), resolution };
    if (this.initialized) this.application.renderer.resize(...this.dimensions());
  }

  render(): void {
    if (this.initialized) this.application.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextrestored', this.redrawAfterRestore);
    if (canvasLeases.get(this.canvas) === this.lease) {
      delete this.canvas.dataset.rendererStatus;
      delete this.canvas.dataset.renderer;
    }
    // Application.destroy requires completed init; pending init cleans up when it settles.
    if (!this.initStarted || this.initCompleted) this.releaseResources();
  }

  private dimensions(): [number, number, number] {
    return [this.size.width, this.size.height, this.size.resolution];
  }

  private async initialize(): Promise<void> {
    if (this.destroyed) return;
    const recovery = contextRecoveries.get(this.canvas);
    if (recovery) await recovery.restore();
    if (this.destroyed) return;
    this.initStarted = true;
    await this.application.init({
      canvas: this.canvas,
      ...this.size,
      autoStart: false,
      sharedTicker: false,
      autoDensity: false,
      preference: ['webgl', 'canvas'],
      antialias: true,
      preserveDrawingBuffer: true,
      background: '#07131a',
      gcActive: false,
      eventMode: 'none',
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    this.initCompleted = true;
    this.application.renderer.events.autoPreventDefault = false;
    // Pixi's scheduler/events also start this shared ticker. All our surfaces render manually.
    Ticker.system.stop();
    if (this.destroyed) {
      this.releaseResources();
      return;
    }
    this.application.renderer.resize(...this.dimensions());
    this.canvas.dataset.renderer = `pixi-${this.application.renderer.name}`;
    this.canvas.dataset.rendererStatus = 'ready';
    this.canvas.addEventListener('webglcontextrestored', this.redrawAfterRestore);
    this.onReady();
    this.canvas.dispatchEvent(new Event('rendererready'));
  }

  private readonly redrawAfterRestore = (): void => {
    if (this.initialized && canvasLeases.get(this.canvas) === this.lease) this.onReady();
  };

  private releaseResources(): void {
    if (this.released) return;
    this.released = true;
    this.canvas.removeEventListener('webglcontextrestored', this.redrawAfterRestore);
    liveSurfaces.delete(this);
    const releaseGlobalResources = liveSurfaces.size === 0;
    try {
      if (this.initCompleted) {
        const renderer = this.application.renderer;
        if ('gl' in renderer) this.prepareContextRecovery(renderer.gl);
        this.application.destroy({ removeView: false, releaseGlobalResources }, destroyChildren);
      } else {
        // Failed/never-started init has no initialized Application plugins to destroy.
        this.stage.destroy(destroyChildren);
        this.application.renderer?.destroy({ removeView: false, releaseGlobalResources });
        if (!this.application.renderer && releaseGlobalResources) GlobalResourceRegistry.release();
      }
    } finally {
      this.releaseLease();
      // A canceled waiter must still carry the preceding owner's lease for later mounts.
      void this.lease.released.then(() => {
        if (canvasLeases.get(this.canvas) === this.lease) canvasLeases.delete(this.canvas);
      });
    }
  }

  private prepareContextRecovery(gl: WebGL2RenderingContext): void {
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) return;
    const canvas = this.canvas;
    // Pixi deliberately loses WebGL on destroy. Retain permission to restore the React-owned canvas.
    const lost = gl.isContextLost()
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          canvas.addEventListener(
            'webglcontextlost',
            (event) => {
              event.preventDefault();
              resolve();
            },
            { once: true },
          );
        });
    let restoring: Promise<void> | undefined;
    const recovery: ContextRecovery = {
      restore: () =>
        (restoring ??= lost.then(
          () =>
            new Promise<void>((resolve, reject) => {
              const finish = (): void => {
                clearTimeout(timeout);
                canvas.removeEventListener('webglcontextrestored', finish);
                if (contextRecoveries.get(canvas) === recovery) contextRecoveries.delete(canvas);
                resolve();
              };
              const timeout = setTimeout(() => {
                canvas.removeEventListener('webglcontextrestored', finish);
                reject(new Error('No se pudo restaurar el contexto gráfico del tablero.'));
              }, 5_000);
              canvas.addEventListener('webglcontextrestored', finish, { once: true });
              extension.restoreContext();
            }),
        )),
    };
    contextRecoveries.set(canvas, recovery);
  }
}
