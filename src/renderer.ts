import { isOnBoard, worldToHex } from './hex';
import { isAirPiece, occupancyAt } from './engine';
import type { GameEvent, GameState, Hex, Player } from './types';
import {
  AIR_LIFT,
  GROUND_LIFT,
  DEPTH_TRANSITION_DURATION,
  boardTilt,
  eventDuration,
  projectHex,
  type RenderModel,
} from './rendering/model';
import { PixiSurface } from './rendering/pixi-surface';
import { PixiBoard } from './rendering/pixi-board';
export {
  actionMarkers,
  actionsAtHex,
  BOARD_NOMINAL_SIZE,
  markerKind,
  movementPose,
  pieceAccessibleLabel,
  type RenderModel,
} from './rendering/model';

interface AnimationState {
  events: GameEvent[];
  before: GameState;
  startedAt: number;
  duration: number;
  resolve: () => void;
}

interface RotationState {
  from: number;
  to: number;
  startedAt: number;
  duration: number;
  resolve: () => void;
}

interface DepthTransitionState {
  from: number;
  to: number;
  startedAt: number;
  duration: number;
}

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly surface: PixiSurface;
  private readonly scene: PixiBoard;
  private unavailable = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionPreference: MediaQueryList;
  private model: RenderModel | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private fitScale = 1;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private frameBounds: { x: number; y: number; width: number; height: number } | null = null;
  private animation: AnimationState | null = null;
  private orientation = Math.PI;
  private rotation: RotationState | null = null;
  private depth = 0;
  private depthTransition: DepthTransitionState | null = null;
  private frameId = 0;
  private visible = false;
  private destroyed = false;
  private needsRender = true;
  private lastRenderAt = -Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.surface = new PixiSurface(
      canvas,
      () => this.resize(),
      () => {
        this.unavailable = true;
        if (this.frameId) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
        this.animation?.resolve();
        this.rotation?.resolve();
        this.animation = null;
        this.rotation = null;
        this.depthTransition = null;
      },
    );
    this.scene = new PixiBoard(this.surface.stage);
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionPreference.addEventListener('change', this.refreshAmbientMotion);
    document.addEventListener('visibilitychange', this.refreshAmbientMotion);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.refreshAmbientMotion();
    });
    this.intersectionObserver.observe(canvas);
    this.canvas.dataset.viewpoint = 'blue';
    this.canvas.dataset.perspective = '2d';
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.requestFrame();
  }

  /** Resolves after initialization (or a handled failure); never rejects on unmount. */
  get ready(): Promise<void> {
    return this.surface.ready;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.motionPreference.removeEventListener('change', this.refreshAmbientMotion);
    document.removeEventListener('visibilitychange', this.refreshAmbientMotion);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    if (this.animation) this.animation.resolve();
    if (this.rotation) this.rotation.resolve();
    this.animation = null;
    this.rotation = null;
    this.depthTransition = null;
    this.scene.destroy();
    this.surface.destroy();
  }

  setModel(model: RenderModel): void {
    this.model = model;
    this.requestFrame();
  }

  /** Stable close-up for instructional sequences, with one cell of context by default. */
  setFrame(positions: readonly Hex[], padding = 65): void {
    if (!positions.length) return;
    const points = positions.map((position) => projectHex(position, this.orientation, 0));
    const minX = Math.min(...points.map((point) => point.x)) - padding;
    const maxX = Math.max(...points.map((point) => point.x)) + padding;
    const minY = Math.min(...points.map((point) => point.y)) - padding;
    const maxY = Math.max(...points.map((point) => point.y)) + padding;
    this.frameBounds = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
    };
    this.requestFrame();
  }

  setDepthMode(enabled: boolean, reducedMotion: boolean): void {
    const target = enabled ? 1 : 0;
    const now = performance.now();
    const from = this.depthAt(now);
    this.depthTransition = null;
    this.canvas.dataset.perspective = enabled ? '2.5d' : '2d';
    if (reducedMotion || Math.abs(from - target) < 0.001) {
      this.depth = target;
      delete this.canvas.dataset.perspectiveTransition;
      this.fitScale = this.fitScaleFor(target);
      this.requestFrame();
      return;
    }
    this.depthTransition = {
      from,
      to: target,
      startedAt: now,
      duration: DEPTH_TRANSITION_DURATION,
    };
    this.canvas.dataset.perspectiveTransition = 'true';
    this.requestFrame();
  }

  resetView(): void {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.requestFrame();
  }

  panBy(dx: number, dy: number): void {
    this.pan.x += dx;
    this.pan.y += dy;
    this.clampPan();
    this.requestFrame();
  }

  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const previous = this.zoom;
    const next = Math.max(0.72, Math.min(2.5, previous * factor));
    if (next === previous) return;

    if (clientX !== undefined && clientY !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const pointer = { x: clientX - rect.left, y: clientY - rect.top };
      const oldScale = this.fitScale * previous;
      const worldX = (pointer.x - this.width / 2 - this.pan.x) / oldScale;
      const worldY = (pointer.y - this.height / 2 - this.pan.y) / oldScale;
      const newScale = this.fitScale * next;
      this.pan.x = pointer.x - this.width / 2 - worldX * newScale;
      this.pan.y = pointer.y - this.height / 2 - worldY * newScale;
    }
    this.zoom = next;
    this.clampPan();
    this.requestFrame();
  }

  clientToHex(clientX: number, clientY: number): Hex | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const scale = this.fitScale * this.zoom;
    const projectedX = (x - this.width / 2 - this.pan.x) / scale;
    const projectedY = (y - this.height / 2 - this.pan.y) / scale;
    const angle = this.orientationAt(performance.now());
    const depth = this.depthAt(performance.now());
    const tilt = boardTilt(depth);
    const pieceHit = this.pieceAtProjectedPoint(projectedX, projectedY, angle, depth);
    if (pieceHit) return pieceHit;

    const screenX = projectedX;
    const screenY = projectedY / tilt;
    const worldX = Math.cos(angle) * screenX + Math.sin(angle) * screenY;
    const worldY = -Math.sin(angle) * screenX + Math.cos(angle) * screenY;
    const hex = worldToHex(worldX, worldY);
    return isOnBoard(hex) ? hex : null;
  }

  private pieceAtProjectedPoint(
    x: number,
    y: number,
    orientation: number,
    depth: number,
  ): Hex | null {
    if (!this.model) return null;
    const pieces = [...this.model.state.pieces].sort(
      (left, right) => Number(isAirPiece(right)) - Number(isAirPiece(left)),
    );
    for (const piece of pieces) {
      const point = projectHex(piece.position, orientation, depth);
      const occupancy = occupancyAt(this.model.state, piece.position);
      const stacked = Boolean(occupancy.ground && occupancy.air);
      const stackX = stacked ? (isAirPiece(piece) ? 4 : -4) : 0;
      const stackY = stacked && !isAirPiece(piece) ? 3 : 0;
      const lift = (isAirPiece(piece) ? AIR_LIFT : GROUND_LIFT) * depth;
      if (Math.hypot(x - point.x - stackX, y - point.y - stackY + lift) <= 21) {
        return { ...piece.position };
      }
    }
    return null;
  }

  snapToPlayer(player: Player): void {
    if (this.rotation) this.rotation.resolve();
    this.rotation = null;
    this.orientation = player === 0 ? Math.PI : 0;
    this.canvas.dataset.viewpoint = player === 0 ? 'blue' : 'amber';
    delete this.canvas.dataset.rotating;
    this.requestFrame();
  }

  rotateToPlayer(player: Player, reducedMotion: boolean): Promise<void> {
    if (this.destroyed || this.unavailable) return Promise.resolve();
    const target = player === 0 ? Math.PI : 0;
    const from = this.orientationAt(performance.now());
    if (Math.abs(from - target) < 0.001) return Promise.resolve();
    if (this.rotation) this.rotation.resolve();
    this.rotation = null;
    if (reducedMotion) {
      this.orientation = target;
      this.canvas.dataset.viewpoint = player === 0 ? 'blue' : 'amber';
      delete this.canvas.dataset.rotating;
      this.requestFrame();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.canvas.dataset.rotating = 'true';
      this.rotation = {
        from,
        to: target,
        startedAt: performance.now(),
        duration: 720,
        resolve,
      };
      this.requestFrame();
    });
  }

  playEvents(
    events: GameEvent[],
    before: GameState,
    reducedMotion: boolean,
    durationScale = 1,
  ): Promise<void> {
    if (this.animation) {
      this.animation.resolve();
      this.animation = null;
    }
    if (this.destroyed || this.unavailable || events.length === 0 || reducedMotion) {
      this.requestFrame();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.animation = {
        events,
        before,
        startedAt: performance.now(),
        duration: eventDuration(events) * durationScale,
        resolve,
      };
      this.requestFrame();
    });
  }

  private readonly frame = (time: number): void => {
    this.frameId = 0;
    if (this.destroyed) return;
    // Idle only needs 30 painted frames/s; input and action animations render immediately.
    if (this.needsRender || this.hasTransition() || time - this.lastRenderAt >= 1000 / 30) {
      this.needsRender = false;
      this.lastRenderAt = time;
      this.render(time);
    }
    if (this.animation && time - this.animation.startedAt >= this.animation.duration) {
      const resolve = this.animation.resolve;
      this.animation = null;
      resolve();
    }
    if (this.rotation && time - this.rotation.startedAt >= this.rotation.duration) {
      const resolve = this.rotation.resolve;
      this.orientation = this.rotation.to;
      this.canvas.dataset.viewpoint = this.rotation.to === Math.PI ? 'blue' : 'amber';
      delete this.canvas.dataset.rotating;
      this.rotation = null;
      resolve();
    }
    if (
      this.depthTransition &&
      time - this.depthTransition.startedAt >= this.depthTransition.duration
    ) {
      this.depth = this.depthTransition.to;
      this.depthTransition = null;
      delete this.canvas.dataset.perspectiveTransition;
    }
    const pulseMarkers = Boolean(
      this.canAnimateAmbient() && this.model && this.model.actions.length > 0,
    );
    if (this.hasTransition() || pulseMarkers || this.canAnimateIdle()) this.scheduleFrame();
  };

  private requestFrame(): void {
    this.needsRender = true;
    this.scheduleFrame();
  }

  private scheduleFrame(): void {
    if (!this.destroyed && !this.unavailable && this.surface.initialized && !this.frameId)
      this.frameId = requestAnimationFrame(this.frame);
  }

  private hasTransition(): boolean {
    return Boolean(this.animation || this.rotation || this.depthTransition);
  }

  private canAnimateAmbient(): boolean {
    return (
      !this.destroyed &&
      this.visible &&
      document.visibilityState !== 'hidden' &&
      !this.motionPreference.matches &&
      Boolean(this.model && !this.model.reducedMotion)
    );
  }

  private canAnimateIdle(): boolean {
    return Boolean(
      this.canAnimateAmbient() &&
      this.model?.idleAnimations &&
      this.model.state.pieces.length > 0 &&
      !this.model.state.outcome,
    );
  }

  private readonly refreshAmbientMotion = (): void => {
    if (this.destroyed) return;
    if (!this.visible || document.visibilityState === 'hidden') {
      // Finite action animations still finish and resolve their gameplay promises.
      if (!this.hasTransition() && this.frameId) {
        cancelAnimationFrame(this.frameId);
        this.frameId = 0;
      }
      return;
    }
    this.requestFrame();
  };

  private clampPan(): void {
    const limitX = this.width * 0.55;
    const limitY = this.height * 0.55;
    this.pan.x = Math.max(-limitX, Math.min(limitX, this.pan.x));
    this.pan.y = Math.max(-limitY, Math.min(limitY, this.pan.y));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.surface.resize(this.width, this.height, this.dpr);
    this.fitScale = this.fitScaleFor(this.depthAt(performance.now()));
    this.clampPan();
    this.requestFrame();
  }

  private render(time: number): void {
    const model = this.model;
    const depth = this.depthAt(time);
    this.fitScale = this.fitScaleFor(depth);
    const impulse = this.cameraImpulseAt(time, model?.reducedMotion ?? true);
    this.scene.update(
      model && this.motionPreference.matches ? { ...model, reducedMotion: true } : model,
      time,
      {
        width: this.width,
        height: this.height,
        x: this.width / 2 + this.pan.x + impulse.x - (this.frameBounds?.x ?? 0) * this.fitScale,
        y: this.height / 2 + this.pan.y + impulse.y - (this.frameBounds?.y ?? 0) * this.fitScale,
        scale: this.fitScale * this.zoom,
        zoom: this.zoom,
        orientation: this.orientationAt(time),
        depth,
        idleTime: this.canAnimateIdle() ? time : undefined,
        frame: this.frameBounds,
      },
      this.animation,
    );
    this.surface.render();
  }

  private cameraImpulseAt(time: number, reducedMotion: boolean): { x: number; y: number } {
    if (!this.animation || reducedMotion) return { x: 0, y: 0 };
    const hasFortressImpact = this.animation.events.some(
      (event) => event.type === 'fortressDamage' || event.type === 'victory',
    );
    if (!hasFortressImpact) return { x: 0, y: 0 };
    const progress = Math.min(1, Math.max(0, (time - this.animation.startedAt) / 280));
    const strength = (1 - progress) * 5.5;
    return {
      x: Math.sin(progress * Math.PI * 10) * strength,
      y: Math.cos(progress * Math.PI * 8) * strength * 0.55,
    };
  }

  private depthAt(time: number): number {
    if (!this.depthTransition) return this.depth;
    const raw = Math.min(
      1,
      Math.max(0, (time - this.depthTransition.startedAt) / this.depthTransition.duration),
    );
    const eased = 1 - (1 - raw) ** 3;
    return (
      this.depthTransition.from + (this.depthTransition.to - this.depthTransition.from) * eased
    );
  }

  private fitScaleFor(depth: number): number {
    if (this.frameBounds) {
      return Math.max(
        0.1,
        Math.min(
          (this.width - 20) / this.frameBounds.width,
          (this.height - 20) / this.frameBounds.height,
        ),
      );
    }
    const verticalExtent = 610 + (500 - 610) * depth;
    return Math.max(0.38, Math.min((this.width - 34) / 560, (this.height - 42) / verticalExtent));
  }

  private orientationAt(time: number): number {
    if (!this.rotation) return this.orientation;
    const raw = Math.min(1, Math.max(0, (time - this.rotation.startedAt) / this.rotation.duration));
    const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
    return this.rotation.from + (this.rotation.to - this.rotation.from) * eased;
  }
}
