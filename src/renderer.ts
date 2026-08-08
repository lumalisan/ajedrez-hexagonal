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
  isAirPiece,
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
  attack: '#ff174f',
  range: '#ff174f',
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

type MarkerKind = 'range' | 'move' | 'capture' | 'shoot' | 'convert' | 'danger';

interface ActionMarker {
  hex: Hex;
  kind: MarkerKind;
  owner?: Player;
  hasRange: boolean;
  canMove: boolean;
  canAttack: boolean;
}

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

  playEvents(events: GameEvent[], before: GameState, reducedMotion: boolean): Promise<void> {
    if (this.animation) {
      this.animation.resolve();
      this.animation = null;
    }
    if (events.length === 0 || reducedMotion) {
      this.requestFrame();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.animation = {
        events,
        before,
        startedAt: performance.now(),
        duration: eventDuration(events),
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
    this.fitScale = Math.max(0.38, Math.min((this.width - 34) / 560, (this.height - 34) / 610));
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
    const orientation = this.orientationAt(time);
    ctx.rotate(orientation);
    this.drawBoardShadow(ctx);
    this.drawCells(ctx, model, orientation);
    this.drawProtectionZones(ctx, model);
    this.drawLastAction(ctx, model.lastEvents);
    this.drawActionMarkers(ctx, model, time);
    this.drawPieces(ctx, model, orientation);
    this.drawTargetOverlays(ctx, model, time, orientation);
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

  private drawCells(ctx: CanvasRenderingContext2D, model: RenderModel, orientation: number): void {
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
        ctx.save();
        ctx.translate(0, 21);
        ctx.rotate(-orientation);
        ctx.globalAlpha = 0.52;
        ctx.fillStyle = COLORS.muted;
        ctx.font = '500 5.6px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${signed(cell.q)} ${signed(cell.r)}`, 0, 0);
        ctx.restore();
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
    const tactical =
      selected?.type === 'drone' ||
      selected?.type === 'airplane' ||
      selected?.type === 'medium' ||
      selected?.type === 'long';

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
    const byCell = actionMarkers(model);
    const pulse = model.reducedMotion ? 0 : (Math.sin(time / 360) + 1) / 2;
    const selected = model.selectedId ? getPiece(model.state, model.selectedId) : undefined;
    const inspectionAlpha = selected && selected.owner !== model.state.activePlayer ? 0.46 : 1;
    for (const marker of byCell.values()) {
      const { x, y } = hexToWorld(marker.hex);
      const color = markerColor(marker);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = (marker.kind === 'range' ? 0.2 : 0.22 + pulse * 0.06) * inspectionAlpha;
      ctx.fillStyle = color;
      hexPath(ctx, 25.6);
      ctx.fill();
      ctx.globalAlpha = (marker.kind === 'range' ? 0.88 : 0.92) * inspectionAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth =
        marker.kind === 'range'
          ? model.highContrast
            ? 2.2
            : 1.65
          : model.highContrast
            ? 2.4
            : 1.7;
      if (marker.hasRange && marker.canMove) {
        ctx.strokeStyle = COLORS.range;
        drawRangeMarker(ctx);
        ctx.strokeStyle = COLORS.move;
        ctx.fillStyle = COLORS.move;
        drawMoveMarker(ctx, 5.2 + pulse * 1.2);
      } else if (marker.kind === 'range') drawRangeMarker(ctx);
      else if (marker.kind === 'move') drawMoveMarker(ctx, 5.2 + pulse * 1.2);
      else if (marker.kind === 'danger') drawDangerMarker(ctx, 12.5);
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

  private drawTargetOverlays(
    ctx: CanvasRenderingContext2D,
    model: RenderModel,
    time: number,
    orientation: number,
  ): void {
    const pulse = model.reducedMotion ? 0 : (Math.sin(time / 360) + 1) / 2;
    const selected = model.selectedId ? getPiece(model.state, model.selectedId) : undefined;
    const inspectionAlpha = selected && selected.owner !== model.state.activePlayer ? 0.46 : 1;
    for (const marker of actionMarkers(model).values()) {
      if (
        marker.kind !== 'capture' &&
        marker.kind !== 'shoot' &&
        marker.kind !== 'convert' &&
        !(marker.hasRange && marker.canMove && marker.canAttack)
      )
        continue;
      const { x, y } = hexToWorld(marker.hex);
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = markerColor(marker);
      ctx.fillStyle = markerColor(marker);
      ctx.lineWidth = model.highContrast ? 3.2 : 2.65;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4;
      ctx.globalAlpha = inspectionAlpha;
      if (marker.kind === 'shoot' || (marker.hasRange && marker.canMove && marker.canAttack))
        drawShootMarker(ctx, 11.5 + pulse);
      else if (marker.kind === 'convert') {
        ctx.rotate(-orientation);
        drawConvertMarker(ctx, 12 + pulse);
      } else drawCaptureMarker(ctx, 5.2 + pulse * 1.2);
      ctx.restore();
    }
  }

  private drawPieces(ctx: CanvasRenderingContext2D, model: RenderModel, orientation: number): void {
    const movingIds = new Set(
      this.animation?.events
        .filter((event) => event.type === 'move')
        .map((event) => event.pieceId) ?? [],
    );
    const ground = model.state.pieces.filter((piece) => !isAirPiece(piece));
    const air = model.state.pieces.filter(isAirPiece);
    const stackedHexes = air
      .filter((unit) => ground.some((piece) => equalHex(piece.position, unit.position)))
      .map((unit) => unit.position);

    for (const hex of stackedHexes) this.drawStackBase(ctx, hex, model.highContrast);
    for (const piece of [...ground, ...air]) {
      if (movingIds.has(piece.id)) continue;
      const point = hexToWorld(piece.position);
      const isStacked = stackedHexes.some((hex) => equalHex(hex, piece.position));
      const stackX = isStacked ? (isAirPiece(piece) ? 5 : -5) : 0;
      const stackY = isStacked ? (isAirPiece(piece) ? -7 : 6) : 0;
      this.drawPiece(ctx, piece, point.x + stackX, point.y + stackY, {
        selected: piece.id === model.selectedId,
        highContrast: model.highContrast,
        alpha: 1,
        isStacked,
      });
    }
    for (const hex of stackedHexes) {
      this.drawStackBadge(ctx, hex, model.highContrast, orientation);
    }
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

  private drawStackBadge(
    ctx: CanvasRenderingContext2D,
    hex: Hex,
    highContrast: boolean,
    orientation: number,
  ): void {
    const point = hexToWorld(hex);
    ctx.save();
    ctx.translate(point.x + 20, point.y - 19);
    ctx.rotate(-orientation);
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
    const airborne = isAirPiece(piece);
    const radius = piece.type === 'fortress' ? 19 : 16.6;
    ctx.save();
    ctx.translate(x, y - (airborne ? 3.5 : 0));
    ctx.globalAlpha = options.alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = options.selected ? 12 : 5;
    ctx.shadowOffsetY = 0;

    if (airborne) {
      ctx.strokeStyle = color;
      ctx.lineWidth = options.selected ? 3 : options.isStacked ? 2.6 : 1.7;
      ctx.globalAlpha = options.alpha * (options.isStacked ? 1 : 0.68);
      ctx.beginPath();
      ctx.ellipse(0, 5.5, 17, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = options.alpha;
    }

    const tokenGradient = ctx.createRadialGradient(-5, -6, 1, 0, 0, radius + 2);
    tokenGradient.addColorStop(0, '#1c3943');
    tokenGradient.addColorStop(0.48, '#102831');
    tokenGradient.addColorStop(1, '#061118');
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = tokenGradient;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = color;
    ctx.lineWidth = options.selected ? 2.8 : options.highContrast ? 2.2 : 1.65;
    if (piece.owner === 1) ctx.setLineDash([4, 2.4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = options.alpha * 0.34;
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 3, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    ctx.globalAlpha = options.alpha * 0.62;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    for (let index = 0; index < 3; index += 1) {
      const angle =
        -Math.PI / 2 + index * ((Math.PI * 2) / 3) + (piece.owner === 1 ? Math.PI / 3 : 0);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (radius - 1.2), Math.sin(angle) * (radius - 1.2));
      ctx.lineTo(Math.cos(angle) * (radius - 4.1), Math.sin(angle) * (radius - 4.1));
      ctx.stroke();
    }
    ctx.globalAlpha = options.alpha;

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
    ctx.lineWidth = options.highContrast ? 2.25 : 1.9;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3.5;
    drawPieceGlyph(ctx, piece);
    ctx.shadowColor = 'transparent';

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

  private drawAnimation(
    ctx: CanvasRenderingContext2D,
    animation: AnimationState,
    time: number,
  ): void {
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
        ctx.lineTo(
          from.x + (to.x - from.x) * Math.min(1, raw * 1.8),
          from.y + (to.y - from.y) * Math.min(1, raw * 1.8),
        );
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

      if (
        (event.type === 'convert' ||
          event.type === 'fortressDamage' ||
          event.type === 'transform') &&
        event.at
      ) {
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

function actionMarkers(model: RenderModel): Map<string, ActionMarker> {
  const byCell = new Map<string, ActionMarker>();
  for (const hex of model.firingRange) {
    byCell.set(hexKey(hex), {
      hex,
      kind: 'range',
      hasRange: true,
      canMove: false,
      canAttack: false,
    });
  }
  for (const action of model.actions) {
    const destination = actionDestination(model.state, action);
    if (!destination) continue;
    const kind = markerKind(model.state, action);
    const piece = getPiece(model.state, action.pieceId);
    const key = hexKey(destination);
    const current = byCell.get(key);
    const canMove = action.kind === 'move' && !action.kamikaze && kind !== 'danger';
    const canAttack =
      kind === 'capture' ||
      kind === 'shoot' ||
      (action.kind === 'move' && Boolean(action.kamikaze));
    if (!current || markerPriority(kind) > markerPriority(current.kind)) {
      byCell.set(key, {
        hex: destination,
        kind,
        owner: piece?.owner,
        hasRange: current?.hasRange ?? false,
        canMove: (current?.canMove ?? false) || canMove,
        canAttack: (current?.canAttack ?? false) || canAttack,
      });
    } else {
      current.canMove ||= canMove;
      current.canAttack ||= canAttack;
    }
  }
  return byCell;
}

function markerColor(marker: ActionMarker): string {
  if (marker.kind === 'convert' && marker.owner !== undefined) {
    return marker.owner === 0 ? COLORS.blue : COLORS.amber;
  }
  if (marker.kind === 'capture' || marker.kind === 'shoot') return COLORS.attack;
  return COLORS[marker.kind];
}

function markerKind(state: GameState, action: GameAction): MarkerKind {
  const piece = getPiece(state, action.pieceId);
  if (!piece) return 'move';
  if (action.kind === 'shoot') return 'shoot';
  if (action.kind === 'attackAbove' || action.kind === 'attackBelow') return 'capture';
  if (action.kind === 'convert') return 'convert';
  if (action.kind === 'transform') {
    if (action.attackAboveId) return 'capture';
    if (!action.to) return 'convert';
    const occupancy = occupancyAt(state, action.to);
    if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner)
      return 'capture';
    if (occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner) return 'capture';
    return 'move';
  }
  if (action.kind === 'rotate' || action.kind === 'orient') return 'convert';
  if (isAirPiece(piece) && isProtectedByPlayer(state, action.to, otherPlayerOf(piece.owner))) {
    return 'danger';
  }
  if (piece.type === 'airplane' && action.kind === 'move') {
    return action.kamikaze ? 'capture' : 'move';
  }
  const occupancy = occupancyAt(state, action.to);
  if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner)
    return 'capture';
  if (occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner) return 'capture';
  return 'move';
}

function markerPriority(kind: MarkerKind): number {
  return { range: -1, move: 0, convert: 1, danger: 2, capture: 3, shoot: 4 }[kind];
}

function eventDuration(events: GameEvent[]): number {
  if (events.some((event) => event.type === 'fortressDamage' || event.type === 'victory'))
    return 520;
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

function drawShootMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-radius, -radius);
  ctx.lineTo(radius, radius);
  ctx.moveTo(radius, -radius);
  ctx.lineTo(-radius, radius);
  ctx.stroke();
}

function drawCaptureMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawConvertMarker(ctx: CanvasRenderingContext2D, radius: number): void {
  const scale = radius / 12;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const angles = [-1.57, -0.82, -0.08, 0.7, 1.52, 2.31, 3.08, 3.88];
  const outerRadii = [10.5, 9.6, 10.2, 9.8, 10.6, 9.7, 10.3, 9.5];

  // Uneven spokes and inward-bowed strands read as a web rather than a wheel.
  for (let index = 0; index < angles.length; index += 1) {
    const angle = angles[index];
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 1.1, Math.sin(angle) * 1.1);
    ctx.lineTo(Math.cos(angle) * outerRadii[index], Math.sin(angle) * outerRadii[index]);
    ctx.stroke();
  }
  for (const ring of [3.4, 6.4, 9.2]) traceWebRing(ctx, angles, outerRadii, ring);

  ctx.beginPath();
  ctx.arc(0, 0, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function traceWebRing(
  ctx: CanvasRenderingContext2D,
  angles: number[],
  outerRadii: number[],
  radius: number,
): void {
  const points = angles.map((angle, index) => {
    const adjustedRadius = Math.min(radius, outerRadii[index]);
    return {
      x: Math.cos(angle) * adjustedRadius,
      y: Math.sin(angle) * adjustedRadius,
    };
  });
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const midAngle =
      (angles[index] +
        (index === points.length - 1 ? angles[0] + Math.PI * 2 : angles[index + 1])) /
      2;
    const sag = radius * 0.9;
    ctx.quadraticCurveTo(Math.cos(midAngle) * sag, Math.sin(midAngle) * sag, next.x, next.y);
  }
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
    case 'capturer': {
      // An open mechanical claw: this unit captures by occupying its target.
      ctx.beginPath();
      ctx.arc(-1, 0, 7.5, Math.PI * 0.25, Math.PI * 1.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4.3, -5.3);
      ctx.lineTo(10, -7.5);
      ctx.lineTo(8.2, -1.5);
      ctx.moveTo(4.3, 5.3);
      ctx.lineTo(10, 7.5);
      ctx.lineTo(8.2, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-1, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'medium':
      drawTankGlyph(ctx, piece.cannon, 10, 1);
      break;
    case 'long':
      drawMissileLauncherGlyph(ctx);
      break;
    case 'fast': {
      // Low-profile assault vehicle with a pointed nose and visible tracks.
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(1, -6.5);
      ctx.lineTo(-6, -5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 5);
      ctx.lineTo(1, 6.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(2, -3.5);
      ctx.lineTo(7.5, 0);
      ctx.lineTo(2, 3.5);
      ctx.stroke();
      for (const y of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(-8, y);
        ctx.lineTo(3, y);
        ctx.stroke();
      }
      break;
    }
    case 'drone': {
      // Four rotors and a central flight computer make the aerial role explicit.
      for (const [rotorX, rotorY] of [
        [-7, -7],
        [7, -7],
        [7, 7],
        [-7, 7],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(rotorX * 0.38, rotorY * 0.38);
        ctx.lineTo(rotorX * 0.78, rotorY * 0.78);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rotorX, rotorY, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(4.5, 0);
      ctx.lineTo(0, 4.5);
      ctx.lineTo(-4.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1b22';
      ctx.fill();
      break;
    }
    case 'airplane': {
      ctx.save();
      ctx.rotate(-Math.PI / 2 + piece.facing * (Math.PI / 3));
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(1.5, -3.2);
      ctx.lineTo(-2, -10);
      ctx.lineTo(-5, -9);
      ctx.lineTo(-3.4, -2.5);
      ctx.lineTo(-10, -1.6);
      ctx.lineTo(-10, 1.6);
      ctx.lineTo(-3.4, 2.5);
      ctx.lineTo(-5, 9);
      ctx.lineTo(-2, 10);
      ctx.lineTo(1.5, 3.2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5.5, 0);
      ctx.lineTo(6.5, 0);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'antiAir': {
      // Radar dish above a twin missile rack.
      ctx.beginPath();
      ctx.arc(0, -1, 9, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -1, 5.5, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -1, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeRect(-7.5, 5, 5, 3.5);
      ctx.strokeRect(2.5, 5, 5, 3.5);
      ctx.beginPath();
      ctx.moveTo(-5, 5);
      ctx.lineTo(-3.5, 2.5);
      ctx.moveTo(5, 5);
      ctx.lineTo(3.5, 2.5);
      ctx.stroke();
      break;
    }
    case 'fortress': {
      // Solid battlements, corner towers and a central gate.
      ctx.beginPath();
      ctx.moveTo(-11, 9);
      ctx.lineTo(-11, -8);
      ctx.lineTo(-7, -8);
      ctx.lineTo(-7, -4);
      ctx.lineTo(-3, -4);
      ctx.lineTo(-3, -8);
      ctx.lineTo(3, -8);
      ctx.lineTo(3, -4);
      ctx.lineTo(7, -4);
      ctx.lineTo(7, -8);
      ctx.lineTo(11, -8);
      ctx.lineTo(11, 9);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3.5, 9);
      ctx.lineTo(-3.5, 4);
      ctx.arc(0, 4, 3.5, Math.PI, 0);
      ctx.lineTo(3.5, 9);
      ctx.stroke();
      ctx.fillRect(-8, -1, 2.5, 3.5);
      ctx.fillRect(5.5, -1, 2.5, 3.5);
      break;
    }
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
  // Top-down hull with separate tracks, rotating turret and calibrated barrel.
  ctx.strokeRect(-7.5, -7, 10.5, 3);
  ctx.strokeRect(-7.5, 4, 10.5, 3);
  ctx.beginPath();
  ctx.moveTo(-6, -4);
  ctx.lineTo(4, -4);
  ctx.lineTo(7, 0);
  ctx.lineTo(4, 4);
  ctx.lineTo(-6, 4);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(barrelLength, 0);
  ctx.stroke();
  for (let index = 0; index < rangeMarks; index += 1) {
    const x = 7.5 + index * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, -1.5);
    ctx.lineTo(x, 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMissileLauncherGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  // Twin guided missiles on a compact tracked launch platform.
  ctx.strokeRect(-8, -8, 5, 16);
  ctx.beginPath();
  ctx.moveTo(-5.5, -6);
  ctx.lineTo(4.5, -6);
  ctx.moveTo(-5.5, 6);
  ctx.lineTo(4.5, 6);
  ctx.moveTo(-2, -8);
  ctx.lineTo(-2, 8);
  ctx.stroke();
  for (const y of [-4, 4]) {
    ctx.beginPath();
    ctx.moveTo(-6.5, y - 1.8);
    ctx.lineTo(5.5, y - 1.8);
    ctx.lineTo(10, y);
    ctx.lineTo(5.5, y + 1.8);
    ctx.lineTo(-6.5, y + 1.8);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, y - 1.8);
    ctx.lineTo(-8, y - 4);
    ctx.moveTo(-5, y + 1.8);
    ctx.lineTo(-8, y + 4);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(-2, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
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

export function pieceAccessibleLabel(
  state: GameState,
  piece: Piece,
  viewpoint: Player = state.activePlayer,
): string {
  const owner = piece.owner === 0 ? 'Cian' : 'Ámbar';
  const position = `${signed(piece.position.q)}, ${signed(piece.position.r)}`;
  const layer = isAirPiece(piece) ? 'aire' : 'suelo';
  const details =
    piece.type === 'soldier'
      ? `, orientado ${directionNameForPlayer(piece.facing, viewpoint)}`
      : piece.type === 'airplane'
        ? `, orientado ${directionNameForPlayer(piece.facing, viewpoint)}`
        : piece.type === 'medium'
          ? `, cañón ${directionNameForPlayer(piece.cannon, viewpoint)}`
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
