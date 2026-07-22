import {
  ALL_DIRECTIONS,
  DIRECTION_NAMES,
  HEX_HEIGHT,
  HEX_WIDTH,
  allBoardHexes,
  equalHex,
  hexDistance,
  hexKey,
  hexToWorld,
  isOnBoard,
  worldToHex,
} from './hex';
import {
  PIECE_SHORT_NAMES,
  actionDestination,
  getPiece,
  isProtectedByPlayer,
  occupancyAt,
  otherPlayerOf,
  protectedCells,
} from './engine';
import type { Direction, GameAction, GameEvent, GameState, Hex, Piece, Player } from './types';

const COLORS = {
  background: '#07131a',
  panel: '#0d2029',
  cellA: '#102832',
  cellB: '#13303a',
  grid: '#668087',
  text: '#f3ebdd',
  muted: '#9fb0b1',
  blue: '#36b9ff',
  amber: '#ffb547',
  move: '#55e0c1',
  attack: '#ff5c8a',
  range: '#ff7ca2',
  convert: '#b8a1ff',
  danger: '#ff765c',
};

export interface RenderModel {
  state: GameState;
  selectedId: string | null;
  actions: GameAction[];
  pending: GameAction | null;
  hovered: Hex | null;
  focused: Hex | null;
  firingRange: Hex[];
  lastEvents: GameEvent[];
  reducedMotion: boolean;
  highContrast: boolean;
}

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

type MarkerKind = 'range' | 'move' | 'attack' | 'convert' | 'danger';

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly cells = allBoardHexes();
  private model: RenderModel | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private fitScale = 1;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private animation: AnimationState | null = null;
  private orientation = Math.PI;
  private rotation: RotationState | null = null;
  private frameId = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D no está disponible en este navegador.');
    this.ctx = context;
    this.canvas.dataset.viewpoint = 'blue';
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.requestFrame();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.animation) this.animation.resolve();
    if (this.rotation) this.rotation.resolve();
  }

  setModel(model: RenderModel): void {
    this.model = model;
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
    const screenX = (x - this.width / 2 - this.pan.x) / scale;
    const screenY = (y - this.height / 2 - this.pan.y) / scale;
    const angle = this.orientationAt(performance.now());
    const worldX = Math.cos(angle) * screenX + Math.sin(angle) * screenY;
    const worldY = -Math.sin(angle) * screenX + Math.cos(angle) * screenY;
    const hex = worldToHex(worldX, worldY);
    return isOnBoard(hex) ? hex : null;
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
    const target = player === 0 ? Math.PI : 0;
    const from = this.orientationAt(performance.now());
    if (Math.abs(from - target) < 0.001) return Promise.resolve();
    if (this.rotation) this.rotation.resolve();
    return new Promise((resolve) => {
      this.canvas.dataset.rotating = 'true';
      this.rotation = {
        from,
        to: target,
        startedAt: performance.now(),
        duration: reducedMotion ? 1 : 720,
        resolve,
      };
      this.requestFrame();
    });
  }

  playEvents(events: GameEvent[], before: GameState, reducedMotion: boolean): Promise<void> {
    if (this.animation) this.animation.resolve();
    if (events.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.animation = {
        events,
        before,
        startedAt: performance.now(),
        duration: reducedMotion ? 90 : eventDuration(events),
        resolve,
      };
      this.requestFrame();
    });
  }

  private readonly frame = (time: number): void => {
    this.frameId = 0;
    this.render(time);
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
    const pulseMarkers = Boolean(
      this.model && this.model.actions.length > 0 && !this.model.reducedMotion,
    );
    if (this.animation || this.rotation || pulseMarkers) this.requestFrame();
  };

  private requestFrame(): void {
    if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
  }

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
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.fitScale = Math.max(
      0.38,
      Math.min((this.width - 34) / 560, (this.height - 34) / 610),
    );
    this.clampPan();
    this.requestFrame();
  }

  private render(time: number): void {
    const model = this.model;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(ctx);
    if (!model) return;

    ctx.save();
    ctx.translate(this.width / 2 + this.pan.x, this.height / 2 + this.pan.y);
    ctx.scale(this.fitScale * this.zoom, this.fitScale * this.zoom);
    ctx.rotate(this.orientationAt(time));
    this.drawBoardShadow(ctx);
    this.drawCells(ctx, model);
    this.drawProtectionZones(ctx, model);
    this.drawLastAction(ctx, model.lastEvents);
    this.drawActionMarkers(ctx, model, time);
    this.drawPieces(ctx, model);
    this.drawFocus(ctx, model);
    if (this.animation) this.drawAnimation(ctx, this.animation, time);
    ctx.restore();
  }

  private orientationAt(time: number): number {
    if (!this.rotation) return this.orientation;
    const raw = Math.min(1, Math.max(0, (time - this.rotation.startedAt) / this.rotation.duration));
    const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
    return this.rotation.from + (this.rotation.to - this.rotation.from) * eased;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createRadialGradient(
      this.width * 0.48,
      this.height * 0.42,
      0,
      this.width * 0.48,
      this.height * 0.42,
      Math.max(this.width, this.height) * 0.78,
    );
    gradient.addColorStop(0, '#102a33');
    gradient.addColorStop(0.62, COLORS.background);
    gradient.addColorStop(1, '#040b10');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#7ca0a7';
    ctx.lineWidth = 0.5;
    const gap = 28;
    for (let x = -this.height; x < this.width + this.height; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - this.height, this.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBoardShadow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
    ctx.shadowBlur = 34;
    ctx.fillStyle = '#09191f';
    boardOutlinePath(ctx);
    ctx.fill();
    ctx.restore();
  }

  private drawCells(ctx: CanvasRenderingContext2D, model: RenderModel): void {
    for (const cell of this.cells) {
      const { x, y } = hexToWorld(cell);
      const ring = hexDistance({ q: 0, r: 0 }, cell);
      ctx.save();
      ctx.translate(x, y);
      hexPath(ctx, 28.9);
      ctx.fillStyle = ring % 2 === 0 ? COLORS.cellA : COLORS.cellB;
      ctx.fill();
      ctx.strokeStyle = model.highContrast ? '#9eb2b4' : COLORS.grid;
      ctx.globalAlpha = model.highContrast ? 0.72 : 0.42;
      ctx.lineWidth = model.highContrast ? 1.25 : 0.75;
      ctx.stroke();

      if (ring > 0) {
        ctx.globalAlpha = 0.08 + ring * 0.008;
        ctx.strokeStyle = ring % 2 ? COLORS.amber : COLORS.blue;
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(0, 0, 19 + ring * 0.45, Math.PI * 0.12, Math.PI * 0.9);
        ctx.stroke();
      }

      if (this.zoom > 1.42) {
        ctx.globalAlpha = 0.52;
        ctx.fillStyle = COLORS.muted;
        ctx.font = '500 5.6px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${signed(cell.q)} ${signed(cell.r)}`, 0, 21);
      }
      ctx.restore();
    }

    const center = hexToWorld({ q: 0, r: 0 });
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.strokeStyle = '#89a8aa';
    ctx.globalAlpha = 0.3;
    for (let radius = 5; radius <= 13; radius += 4) {
      hexPath(ctx, radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawProtectionZones(ctx: CanvasRenderingContext2D, model: RenderModel): void {
    const blue = protectedCells(model.state, 0);
    const amber = protectedCells(model.state, 1);
    const selected = model.selectedId ? getPiece(model.state, model.selectedId) : undefined;
    const tactical = selected?.type === 'drone' || selected?.type === 'medium' || selected?.type === 'long';

    for (const cell of this.cells) {
      const key = hexKey(cell);
      const owners: Player[] = [];
      if (blue.has(key)) owners.push(0);
      if (amber.has(key)) owners.push(1);
      if (owners.length === 0) continue;
      const { x, y } = hexToWorld(cell);

      ctx.save();
      ctx.translate(x, y);
      hexPath(ctx, 27.1);
      ctx.clip();
      for (const [index, owner] of owners.entries()) {
        const color = owner === 0 ? COLORS.blue : COLORS.amber;
        const enemyRelevant = tactical && selected && selected.owner !== owner;
        ctx.globalAlpha = enemyRelevant ? 0.18 : 0.055;
        ctx.fillStyle = color;
        ctx.fillRect(-30, -27, 60, 54);
        ctx.strokeStyle = color;
        ctx.lineWidth = enemyRelevant ? 1.25 : 0.7;
        for (let offset = -48; offset <= 48; offset += 9) {
          ctx.beginPath();
          ctx.moveTo(-30, offset + index * 4);
          ctx.lineTo(30, offset - 36 + index * 4);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawLastAction(ctx: CanvasRenderingContext2D, events: GameEvent[]): void {
    const moves = events.filter(
      (event): event is GameEvent & { from: Hex; to: Hex } =>
        event.type === 'move' && Boolean(event.from) && Boolean(event.to),
    );
    const shots = events.filter(
      (event): event is GameEvent & { from: Hex; to: Hex } =>
        event.type === 'shoot' && Boolean(event.from) && Boolean(event.to),
    );
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.1;
    for (const event of [...moves, ...shots]) {
      const from = hexToWorld(event.from);
      const to = hexToWorld(event.to);
      ctx.strokeStyle = event.type === 'shoot' ? COLORS.attack : COLORS.move;
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawActionMarkers(ctx: CanvasRenderingContext2D, model: RenderModel, time: number): void {
    const byCell = new Map<string, { hex: Hex; kind: MarkerKind }>();
    for (const hex of model.firingRange) {
      byCell.set(hexKey(hex), { hex, kind: 'range' });
    }
    for (const action of model.actions) {
      const destination = actionDestination(model.state, action);
      if (!destination) continue;
      const kind = markerKind(model.state, action);
      const key = hexKey(destination);
      const current = byCell.get(key);
      if (!current || markerPriority(kind) > markerPriority(current.kind)) {
        byCell.set(key, { hex: destination, kind });
      }
    }

    const pulse = model.reducedMotion ? 0 : (Math.sin(time / 360) + 1) / 2;
    for (const marker of byCell.values()) {
      const { x, y } = hexToWorld(marker.hex);
      const color = COLORS[marker.kind];
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = marker.kind === 'range' ? 0.1 : 0.22 + pulse * 0.06;
      ctx.fillStyle = color;
      hexPath(ctx, 25.6);
      ctx.fill();
      ctx.globalAlpha = marker.kind === 'range' ? 0.48 : 0.92;
      ctx.strokeStyle = color;
      ctx.lineWidth = marker.kind === 'range' ? (model.highContrast ? 1.8 : 1.15) : model.highContrast ? 2.4 : 1.7;
      if (marker.kind === 'range') drawRangeMarker(ctx);
      else if (marker.kind === 'attack') drawAttackMarker(ctx, 14 + pulse * 1.4);
      else if (marker.kind === 'convert') drawConvertMarker(ctx, 12 + pulse);
      else if (marker.kind === 'danger') drawDangerMarker(ctx, 12.5);
      else drawMoveMarker(ctx, 5.2 + pulse * 1.2);
      ctx.restore();
    }

    if (model.pending) {
      const destination = actionDestination(model.state, model.pending);
      if (destination) {
        const point = hexToWorld(destination);
        ctx.save();
        ctx.translate(point.x, point.y);
        ctx.strokeStyle = COLORS.text;
        ctx.lineWidth = 2.25;
        ctx.globalAlpha = 0.92;
        hexPath(ctx, 26.8);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawPieces(ctx: CanvasRenderingContext2D, model: RenderModel): void {
    const movingIds = new Set(
      this.animation?.events.filter((event) => event.type === 'move').map((event) => event.pieceId) ?? [],
    );
    const ground = model.state.pieces.filter((piece) => piece.type !== 'drone');
    const air = model.state.pieces.filter((piece) => piece.type === 'drone');
    const stackedHexes = air
      .filter((drone) => ground.some((piece) => equalHex(piece.position, drone.position)))
      .map((drone) => drone.position);

    for (const hex of stackedHexes) this.drawStackBase(ctx, hex, model.highContrast);
    for (const piece of [...ground, ...air]) {
      if (movingIds.has(piece.id)) continue;
      const point = hexToWorld(piece.position);
      const isStacked = stackedHexes.some((hex) => equalHex(hex, piece.position));
      const stackX = isStacked ? (piece.type === 'drone' ? 5 : -5) : 0;
      const stackY = isStacked ? (piece.type === 'drone' ? -7 : 6) : 0;
      this.drawPiece(ctx, piece, point.x + stackX, point.y + stackY, {
        selected: piece.id === model.selectedId,
        highContrast: model.highContrast,
        alpha: 1,
        isStacked,
      });
    }
    for (const hex of stackedHexes) this.drawStackBadge(ctx, hex, model.highContrast);
  }

  private drawStackBase(ctx: CanvasRenderingContext2D, hex: Hex, highContrast: boolean): void {
    const point = hexToWorld(hex);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = 'rgba(5, 15, 20, 0.82)';
    ctx.strokeStyle = highContrast ? COLORS.text : COLORS.move;
    ctx.lineWidth = highContrast ? 2 : 1.25;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.ellipse(0, 2, 25, 20, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawStackBadge(ctx: CanvasRenderingContext2D, hex: Hex, highContrast: boolean): void {
    const point = hexToWorld(hex);
    ctx.save();
    ctx.translate(point.x + 20, point.y - 19);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = highContrast ? COLORS.text : COLORS.move;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = COLORS.background;
    ctx.font = '700 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2', 0, 0.5);
    ctx.restore();
  }

  private drawPiece(
    ctx: CanvasRenderingContext2D,
    piece: Piece,
    x: number,
    y: number,
    options: { selected: boolean; highContrast: boolean; alpha: number; isStacked?: boolean },
  ): void {
    const color = piece.owner === 0 ? COLORS.blue : COLORS.amber;
    const airborne = piece.type === 'drone';
    ctx.save();
    ctx.translate(x, y - (airborne ? 3.5 : 0));
    ctx.globalAlpha = options.alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 2;

    if (airborne) {
      ctx.strokeStyle = color;
      ctx.lineWidth = options.selected ? 3 : options.isStacked ? 2.6 : 1.7;
      ctx.globalAlpha = options.alpha * (options.isStacked ? 1 : 0.68);
      ctx.beginPath();
      ctx.ellipse(0, 5.5, 17, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = options.alpha;
    }

    ctx.beginPath();
    ctx.arc(0, 0, piece.type === 'fortress' ? 18 : 15.8, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1b22';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = color;
    ctx.lineWidth = options.selected ? 3 : options.highContrast ? 2.3 : 1.8;
    if (piece.owner === 1) ctx.setLineDash([4, 2.4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (options.selected) {
      ctx.globalAlpha = options.alpha * 0.5;
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 19.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = options.alpha;
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    drawPieceGlyph(ctx, piece);

    if (piece.type === 'fortress') {
      drawFortressHealth(ctx, piece.hp, color);
    } else {
      drawOwnerMark(ctx, piece.owner, color);
    }
    ctx.restore();
  }

  private drawFocus(ctx: CanvasRenderingContext2D, model: RenderModel): void {
    for (const [hex, alpha, color] of [
      [model.hovered, 0.56, COLORS.text],
      [model.focused, 0.88, COLORS.move],
    ] as const) {
      if (!hex) continue;
      const point = hexToWorld(hex);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.45;
      hexPath(ctx, 27.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawAnimation(ctx: CanvasRenderingContext2D, animation: AnimationState, time: number): void {
    const raw = Math.min(1, Math.max(0, (time - animation.startedAt) / animation.duration));
    const eased = 1 - (1 - raw) ** 3;

    for (const event of animation.events) {
      if (event.type === 'move' && event.pieceId && event.from && event.to) {
        const beforePiece = getPiece(animation.before, event.pieceId);
        const transformed = animation.events.some(
          (candidate) => candidate.type === 'transform' && candidate.pieceId === event.pieceId,
        );
        const afterPiece = this.model ? getPiece(this.model.state, event.pieceId) : undefined;
        const piece = transformed && afterPiece ? afterPiece : beforePiece;
        if (!piece) continue;
        const from = hexToWorld(event.from);
        const to = hexToWorld(event.to);
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased - Math.sin(raw * Math.PI) * 4;
        const survives = this.model ? Boolean(getPiece(this.model.state, piece.id)) : true;
        this.drawPiece(ctx, piece, x, y, {
          selected: false,
          highContrast: this.model?.highContrast ?? false,
          alpha: survives ? 1 : Math.max(0, 1 - raw * 0.9),
        });
      }

      if (event.type === 'shoot' && event.from && event.to) {
        const from = hexToWorld(event.from);
        const to = hexToWorld(event.to);
        ctx.save();
        ctx.globalAlpha = Math.sin(raw * Math.PI);
        ctx.strokeStyle = COLORS.attack;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 3]);
        ctx.lineDashOffset = -raw * 22;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(from.x + (to.x - from.x) * Math.min(1, raw * 1.8), from.y + (to.y - from.y) * Math.min(1, raw * 1.8));
        ctx.stroke();
        ctx.restore();
      }

      if ((event.type === 'destroy' || event.type === 'intercept') && event.at) {
        const at = hexToWorld(event.at);
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.globalAlpha = Math.sin(raw * Math.PI);
        ctx.strokeStyle = event.type === 'intercept' ? COLORS.danger : COLORS.attack;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 5 + eased * 22, 0, Math.PI * 2);
        ctx.stroke();
        for (const direction of ALL_DIRECTIONS) {
          const angle = -Math.PI / 2 + direction * (Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
          ctx.lineTo(Math.cos(angle) * (10 + eased * 15), Math.sin(angle) * (10 + eased * 15));
          ctx.stroke();
        }
        ctx.restore();
      }

      if ((event.type === 'convert' || event.type === 'fortressDamage' || event.type === 'transform') && event.at) {
        const at = hexToWorld(event.at);
        ctx.save();
        ctx.translate(at.x, at.y);
        ctx.globalAlpha = Math.sin(raw * Math.PI) * 0.9;
        ctx.strokeStyle = event.type === 'fortressDamage' ? COLORS.attack : COLORS.convert;
        ctx.lineWidth = 2.3;
        ctx.rotate(raw * Math.PI * 0.6);
        hexPath(ctx, 18 + eased * 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function markerKind(state: GameState, action: GameAction): MarkerKind {
  const piece = getPiece(state, action.pieceId);
  if (!piece) return 'move';
  if (action.kind === 'shoot' || action.kind === 'attackAbove' || action.kind === 'attackBelow') return 'attack';
  if (action.kind === 'convert') return 'convert';
  if (action.kind === 'transform') {
    if (action.attackAboveId) return 'attack';
    if (!action.to) return 'convert';
    const occupancy = occupancyAt(state, action.to);
    if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner) return 'attack';
    if (occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner) return 'attack';
    return 'convert';
  }
  if (action.kind === 'rotate' || action.kind === 'orient') return 'convert';
  if (piece.type === 'drone' && isProtectedByPlayer(state, action.to, otherPlayerOf(piece.owner))) {
    return 'danger';
  }
  const occupancy = occupancyAt(state, action.to);
  if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner) return 'attack';
  if (occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner) return 'attack';
  return 'move';
}

function markerPriority(kind: MarkerKind): number {
  return { range: -1, move: 0, convert: 1, danger: 2, attack: 3 }[kind];
}

function eventDuration(events: GameEvent[]): number {
  if (events.some((event) => event.type === 'fortressDamage' || event.type === 'victory')) return 520;
  if (events.some((event) => event.type === 'convert' || event.type === 'transform')) return 390;
  if (events.some((event) => event.type === 'shoot' || event.type === 'intercept')) return 330;
  return 260;
}

function hexPath(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = index * (Math.PI / 3);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function boardOutlinePath(ctx: CanvasRenderingContext2D): void {
  const corners = [
    { q: 0, r: -5 },
    { q: 5, r: -5 },
    { q: 5, r: 0 },
    { q: 0, r: 5 },
    { q: -5, r: 5 },
    { q: -5, r: 0 },
  ];
  ctx.beginPath();
  for (const [index, corner] of corners.entries()) {
    const point = hexToWorld(corner);
    const angle = -Math.PI / 2 + index * (Math.PI / 3);
    const x = point.x + Math.cos(angle) * 34;
    const y = point.y + Math.sin(angle) * 34;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawMoveMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.move;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRangeMarker(ctx: CanvasRenderingContext2D): void {
  ctx.setLineDash([3, 4]);
  hexPath(ctx, 20.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawAttackMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.48, 0, Math.PI * 2);
  ctx.stroke();
  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 4 + index * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(Math.cos(angle) * radius * 0.62, Math.sin(angle) * radius * 0.62);
    ctx.stroke();
  }
}

function drawConvertMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0.2, Math.PI * 1.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius - 4, Math.PI + 0.2, Math.PI * 2.55);
  ctx.stroke();
}

function drawDangerMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, radius * 0.78);
  ctx.lineTo(-radius, radius * 0.78);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = COLORS.danger;
  ctx.font = '700 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 3);
}

function drawPieceGlyph(ctx: CanvasRenderingContext2D, piece: Piece): void {
  switch (piece.type) {
    case 'soldier': {
      ctx.save();
      ctx.rotate(-Math.PI / 2 + piece.facing * (Math.PI / 3));
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-3, -7);
      ctx.lineTo(0, 0);
      ctx.lineTo(-3, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'capturer':
      ctx.beginPath();
      ctx.arc(0, 1, 5, -Math.PI * 0.65, Math.PI * 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(-9, -9);
      ctx.lineTo(-7, -2);
      ctx.moveTo(-2, 8);
      ctx.lineTo(-9, 10);
      ctx.lineTo(-7, 3);
      ctx.stroke();
      break;
    case 'medium':
      drawTankGlyph(ctx, piece.cannon, 9, 2);
      break;
    case 'long':
      drawTankGlyph(ctx, 0, 13, 3);
      break;
    case 'fast':
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      for (let y = -5; y <= 5; y += 5) {
        ctx.beginPath();
        ctx.moveTo(-9, y);
        ctx.lineTo(-13, y);
        ctx.stroke();
      }
      break;
    case 'drone':
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(-9, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'antiAir':
      ctx.beginPath();
      ctx.arc(0, 3, 10, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 3, 6, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 3, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'fortress':
      ctx.beginPath();
      ctx.moveTo(-10, 8);
      ctx.lineTo(-10, -6);
      ctx.lineTo(-5, -6);
      ctx.lineTo(-5, -10);
      ctx.lineTo(0, -10);
      ctx.lineTo(0, -6);
      ctx.lineTo(5, -6);
      ctx.lineTo(5, -10);
      ctx.lineTo(10, -10);
      ctx.lineTo(10, 8);
      ctx.closePath();
      ctx.stroke();
      break;
  }
}

function drawTankGlyph(
  ctx: CanvasRenderingContext2D,
  direction: number,
  barrelLength: number,
  rangeMarks: number,
): void {
  ctx.save();
  ctx.rotate(-Math.PI / 2 + direction * (Math.PI / 3));
  ctx.strokeRect(-7, -6, 12, 12);
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(barrelLength, 0);
  ctx.stroke();
  for (let index = 0; index < rangeMarks; index += 1) {
    const x = -9 - index * 2.8;
    ctx.beginPath();
    ctx.moveTo(x, -4);
    ctx.lineTo(x, 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFortressHealth(ctx: CanvasRenderingContext2D, hp: number, color: string): void {
  ctx.fillStyle = color;
  for (let index = 0; index < 2; index += 1) {
    ctx.globalAlpha = index < hp ? 1 : 0.18;
    ctx.fillRect(-7 + index * 8, 12, 6, 2.5);
  }
  ctx.globalAlpha = 1;
}

function drawOwnerMark(ctx: CanvasRenderingContext2D, owner: Player, color: string): void {
  ctx.fillStyle = color;
  if (owner === 0) {
    ctx.beginPath();
    ctx.arc(0, 12, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.save();
    ctx.translate(0, 11.5);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
    ctx.restore();
  }
}

export function pieceAccessibleLabel(state: GameState, piece: Piece): string {
  const owner = piece.owner === 0 ? 'Cian' : 'Ámbar';
  const position = `${signed(piece.position.q)}, ${signed(piece.position.r)}`;
  const layer = piece.type === 'drone' ? 'aire' : 'suelo';
  const details = piece.type === 'soldier'
    ? `, orientado ${directionNameForPlayer(piece.facing, state.activePlayer)}`
    : piece.type === 'medium'
      ? `, cañón ${directionNameForPlayer(piece.cannon, state.activePlayer)}`
      : piece.type === 'fortress'
        ? `, ${piece.hp} puntos de vida`
        : '';
  const protectedByEnemy = isProtectedByPlayer(state, piece.position, otherPlayerOf(piece.owner))
    ? ', en zona antiaérea enemiga'
    : '';
  return `${PIECE_SHORT_NAMES[piece.type]}, ${owner}, ${layer}, coordenadas ${position}${details}${protectedByEnemy}`;
}

function directionNameForPlayer(direction: Direction, player: Player): string {
  return DIRECTION_NAMES[((direction + (player === 0 ? 3 : 0)) % 6) as Direction];
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function actionsAtHex(state: GameState, actions: GameAction[], hex: Hex): GameAction[] {
  return actions.filter((action) => {
    const destination = actionDestination(state, action);
    return destination ? equalHex(destination, hex) : false;
  });
}

export const BOARD_NOMINAL_SIZE = { width: HEX_WIDTH * 9, height: HEX_HEIGHT * 11 };
