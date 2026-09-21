import { Container, Graphics } from 'pixi.js';
import { actionDestination, getPiece, isAirPiece, occupancyAt, protectedCells } from '../engine';
import { allBoardHexes, hexKey, hexToWorld } from '../hex';
import type { Hex, Piece } from '../types';
import {
  COLORS,
  actionMarkers,
  markerColor,
  projectHex,
  type ActionMarker,
  type RenderModel,
} from './model';
import { hexPoints, strokeDashedPath } from './shapes';

type TargetKind = 'move' | 'capture' | 'shoot' | 'convert';

/** Tactical graphics are retained; animation only changes transforms and opacity. */
export class PixiOverlays {
  readonly board = new Container({ label: 'board-overlays', eventMode: 'none' });
  readonly targets = new Container({ label: 'target-overlays', eventMode: 'none' });

  private readonly protection = new Graphics({ label: 'protection-hatching' });
  private readonly threats = new Graphics({ label: 'threat-zones' });
  private readonly lastAction = new Graphics({ label: 'last-action' });
  private readonly markerLayer = new Container({ label: 'action-markers' });
  private readonly pending = new Graphics({ label: 'pending-destination' });
  private readonly hovered = new Graphics({ label: 'hovered-cell' });
  private readonly focused = new Graphics({ label: 'focused-cell' });
  private readonly markerViews = new Map<string, MarkerView>();
  private readonly cells = allBoardHexes();
  private model: RenderModel | null = null;
  private markers = new Map<string, ActionMarker>();
  private threatKey = '';
  private lastActionKey = '';
  private destroyed = false;

  constructor() {
    this.pending.poly(hexPoints(26.8), true).stroke({ color: COLORS.text, width: 2.25 });
    this.pending.alpha = 0.92;
    this.hovered.poly(hexPoints(27.2), true).stroke({ color: COLORS.text, width: 1.45 });
    this.hovered.alpha = 0.56;
    this.focused.poly(hexPoints(27.2), true).stroke({ color: COLORS.move, width: 1.45 });
    this.focused.alpha = 0.88;
    this.board.addChild(
      this.protection,
      this.threats,
      this.lastAction,
      this.markerLayer,
      this.pending,
      this.hovered,
      this.focused,
    );
    this.pending.visible = false;
    this.hovered.visible = false;
    this.focused.visible = false;
  }

  update(model: RenderModel, time: number, orientation: number, depth: number): void {
    if (this.destroyed) return;
    const previous = this.model;
    const selected = model.selectedId ? getPiece(model.state, model.selectedId) : undefined;
    if (previous !== model) {
      if (previous?.state !== model.state || previous.selectedId !== model.selectedId)
        this.updateProtection(model, selected);
      this.updateThreats(model);
      this.updateLastAction(model);
      if (
        previous?.state !== model.state ||
        previous.actions !== model.actions ||
        previous.firingRange !== model.firingRange
      )
        this.markers = actionMarkers(model);
      this.updateMarkers(model, selected);
      positionAtHex(
        this.pending,
        model.pending ? actionDestination(model.state, model.pending) : null,
      );
      positionAtHex(this.hovered, model.hovered);
      positionAtHex(this.focused, model.focused);
      this.model = model;
    }

    const pulse = model.reducedMotion ? 0 : (Math.sin(time / 360) + 1) / 2;
    for (const [key, marker] of this.markers) {
      const view = this.markerViews.get(key);
      if (!view) continue;
      view.animate(pulse);
      if (view.target.visible) {
        const point = projectHex(marker.hex, orientation, depth);
        view.target.position.set(point.x, point.y);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.board.destroyed) this.board.destroy({ children: true, context: true });
    if (!this.targets.destroyed) this.targets.destroy({ children: true, context: true });
    this.markerViews.clear();
    this.markers.clear();
    this.model = null;
  }

  private updateProtection(model: RenderModel, selected: Piece | undefined): void {
    const blue = protectedCells(model.state, 0);
    const amber = protectedCells(model.state, 1);
    const tactical =
      selected?.type === 'drone' ||
      selected?.type === 'airplane' ||
      selected?.type === 'medium' ||
      selected?.type === 'long';
    this.protection.clear();
    for (const cell of this.cells) {
      const key = hexKey(cell);
      const owners = ([0, 1] as const).filter((owner) => (owner === 0 ? blue : amber).has(key));
      if (!owners.length) continue;
      const { x, y } = hexToWorld(cell);
      for (const [index, owner] of owners.entries()) {
        const relevant = tactical && selected?.owner !== owner;
        const color = owner === 0 ? COLORS.blue : COLORS.amber;
        const alpha = relevant ? 0.18 : 0.055;
        this.protection
          .beginPath()
          .poly(hexPoints(27.1, x, y), true)
          .fill({ color, alpha });
        this.protection.beginPath();
        for (let offset = -48; offset <= 48; offset += 9) {
          const clipped = clipHatch(-30, offset + index * 4, 30, offset - 36 + index * 4);
          if (!clipped) continue;
          this.protection
            .moveTo(x + clipped[0], y + clipped[1])
            .lineTo(x + clipped[2], y + clipped[3]);
        }
        this.protection.stroke({ color, alpha, width: relevant ? 1.25 : 0.7 });
      }
    }
  }

  private updateThreats(model: RenderModel): void {
    const key = `${model.highContrast}:${model.threatenedCells.map(hexKey).join(';')}`;
    if (key === this.threatKey) return;
    this.threatKey = key;
    this.threats.clear();
    for (const cell of model.threatenedCells) {
      const { x, y } = hexToWorld(cell);
      strokeDashedPath(
        this.threats,
        hexPoints(23.8, x, y),
        3,
        3,
        {
          color: COLORS.threat,
          alpha: 0.92,
          width: model.highContrast ? 2.4 : 1.65,
        },
        true,
      );
      this.threats.beginPath();
      for (let direction = 0; direction < 6; direction++) {
        const angle = direction * (Math.PI / 3);
        this.threats
          .moveTo(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20)
          .lineTo(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
      }
      this.threats.stroke({
        color: COLORS.threat,
        alpha: 0.92,
        width: model.highContrast ? 2.8 : 2,
      });
    }
  }

  private updateLastAction(model: RenderModel): void {
    const lines = model.lastEvents.filter(
      (event) => (event.type === 'move' || event.type === 'shoot') && event.from && event.to,
    );
    const key = lines
      .map((event) => `${event.type}:${hexKey(event.from!)}:${hexKey(event.to!)}`)
      .join(';');
    if (key === this.lastActionKey) return;
    this.lastActionKey = key;
    this.lastAction.clear();
    // Preserve the painter order of movement traces followed by shot traces.
    for (const type of ['move', 'shoot'] as const) {
      for (const event of lines) {
        if (event.type !== type || !event.from || !event.to) continue;
        const from = hexToWorld(event.from);
        const to = hexToWorld(event.to);
        strokeDashedPath(this.lastAction, [from.x, from.y, to.x, to.y], 4, 4, {
          color: type === 'shoot' ? COLORS.attack : COLORS.move,
          width: 1.1,
          alpha: 0.34,
        });
      }
    }
  }

  private updateMarkers(model: RenderModel, selected: Piece | undefined): void {
    for (const [key, view] of this.markerViews) {
      if (this.markers.has(key)) continue;
      view.board.visible = false;
      view.target.visible = false;
    }
    const inspectionAlpha = selected && selected.owner !== model.state.activePlayer ? 0.46 : 1;
    for (const [key, marker] of this.markers) {
      let view = this.markerViews.get(key);
      if (!view) {
        view = new MarkerView();
        view.board.label = `action-marker-${key}`;
        view.target.label = `target-marker-${key}`;
        this.markerViews.set(key, view);
        this.markerLayer.addChild(view.board);
        this.targets.addChild(view.target);
      }
      const position = hexToWorld(marker.hex);
      view.board.position.set(position.x, position.y);
      view.configure(marker, model.highContrast, targetKind(model, marker, selected));
      view.board.visible = true;
      view.board.alpha = inspectionAlpha;
      view.target.alpha = inspectionAlpha;
    }
  }
}

class MarkerView {
  readonly board = new Container();
  readonly target = new Container();
  private readonly fill = new Graphics().poly(hexPoints(25.6), true).fill(0xffffff);
  private readonly glyph = new Container();
  private readonly range = new Graphics();
  private readonly moveDot = new Graphics();
  private readonly moveRing = new Graphics();
  private readonly danger = new Graphics();
  private readonly targetShape = new Graphics();
  private readonly targetHalo = new Graphics();
  private readonly targetDot = new Graphics();
  private readonly targetDotHalo = new Graphics();
  private key = '';
  private targetKey = '';
  private isRange = false;
  private moving = false;
  private targetKind: TargetKind | null = null;

  constructor() {
    this.board.addChild(this.fill, this.glyph);
    this.glyph.addChild(this.range, this.moveRing, this.moveDot, this.danger);
    this.target.addChild(this.targetHalo, this.targetDotHalo, this.targetShape, this.targetDot);
    this.targetHalo.alpha = 0.72;
    this.targetDotHalo.alpha = 0.72;
  }

  configure(marker: ActionMarker, highContrast: boolean, target: TargetKind | null): void {
    const color = markerColor(marker);
    const key = `${marker.kind}:${color}:${marker.hasRange}:${marker.canMove}:${highContrast}`;
    this.targetKind = target;
    this.target.visible = target !== null;
    if (key !== this.key) {
      this.key = key;
      this.isRange = marker.kind === 'range';
      const combined = marker.hasRange && marker.canMove;
      const width = this.isRange ? (highContrast ? 2.2 : 1.65) : highContrast ? 2.4 : 1.7;
      this.fill.tint = color;
      this.glyph.alpha = this.isRange ? 0.88 : 0.92;
      this.range.visible = combined || this.isRange;
      this.moving = combined || marker.kind === 'move';
      this.moveDot.visible = this.moving;
      this.moveRing.visible = this.moving;
      this.danger.visible = !combined && marker.kind === 'danger';
      this.range.clear();
      this.moveDot.clear();
      this.moveRing.clear();
      this.danger.clear();
      if (this.range.visible) {
        strokeDashedPath(this.range, hexPoints(20.5), 3, 4, { color: COLORS.range, width }, true);
        this.range.beginPath().circle(0, 0, 3.2).stroke({ color: COLORS.range, width });
      }
      if (this.moving) {
        this.moveDot.circle(0, 0, 5.2).fill(COLORS.move);
        this.moveRing.circle(0, 0, 10.2).stroke({ color: COLORS.move, width });
      }
      if (this.danger.visible) {
        this.danger.poly([0, -12.5, 12.5, 9.75, -12.5, 9.75], true).stroke({ color, width });
        this.danger.beginPath().roundRect(-1.05, -2.5, 2.1, 5.2, 0.6).fill(color);
        this.danger.beginPath().circle(0, 5.4, 1.15).fill(color);
      }
    }
    const targetKey = `${target}:${color}:${highContrast}`;
    if (target === null || targetKey === this.targetKey) return;
    this.targetKey = targetKey;
    this.targetShape.clear();
    this.targetHalo.clear();
    this.targetDot.clear();
    this.targetDotHalo.clear();
    const width = highContrast ? 3.2 : 2.65;
    if (target === 'move' || target === 'capture') {
      this.targetShape.circle(0, 0, 10.2).stroke({ color, width });
      this.targetHalo.circle(0, 0, 10.2).stroke({ color: 0x000000, width: width + 4 });
      this.targetDot.circle(0, 0, 5.2).fill(color);
      this.targetDotHalo.circle(0, 0, 6.7).fill(0x000000);
    } else if (target === 'shoot') {
      drawCross(this.targetShape, 11.5, color, width);
      drawCross(this.targetHalo, 11.5, 0x000000, width + 4);
    } else {
      drawWeb(this.targetShape, color, width);
      drawWeb(this.targetHalo, 0x000000, width + 3);
    }
  }

  animate(pulse: number): void {
    this.fill.alpha = this.isRange ? 0.2 : 0.22 + pulse * 0.06;
    const radius = 5.2 + pulse * 1.2;
    if (this.moving) {
      this.moveDot.scale.set(radius / 5.2);
      this.moveRing.scale.set((radius + 5) / 10.2);
    }
    if (!this.target.visible) return;
    const circle = this.targetKind === 'move' || this.targetKind === 'capture';
    const scale = circle
      ? (radius + 5) / 10.2
      : this.targetKind === 'shoot'
        ? (11.5 + pulse) / 11.5
        : (12 + pulse) / 12;
    this.targetShape.scale.set(scale);
    this.targetHalo.scale.set(scale);
    this.targetDot.scale.set(circle ? radius / 5.2 : 1);
    this.targetDotHalo.scale.set(circle ? (radius + 1.5) / 6.7 : 1);
  }
}

function targetKind(
  model: RenderModel,
  marker: ActionMarker,
  selected: Piece | undefined,
): TargetKind | null {
  const occupancy = occupancyAt(model.state, marker.hex);
  const occupiedLayer =
    marker.canMove &&
    Boolean(
      selected &&
      (isAirPiece(selected)
        ? occupancy.ground && occupancy.ground.owner === selected.owner
        : occupancy.air &&
          (occupancy.air.owner === selected.owner || occupancy.air.type === 'airplane')),
    );
  const combinedAttack = marker.hasRange && marker.canMove && marker.canAttack;
  if (
    marker.kind !== 'capture' &&
    marker.kind !== 'shoot' &&
    marker.kind !== 'convert' &&
    !combinedAttack &&
    !occupiedLayer
  )
    return null;
  if (occupiedLayer && marker.kind === 'move') return 'move';
  if (marker.kind === 'shoot' || combinedAttack) return 'shoot';
  if (marker.kind === 'convert') return 'convert';
  return 'capture';
}

function positionAtHex(graphics: Graphics, hex: Hex | null): void {
  graphics.visible = hex !== null;
  if (!hex) return;
  const point = hexToWorld(hex);
  graphics.position.set(point.x, point.y);
}

function drawCross(
  graphics: Graphics,
  radius: number,
  color: string | number,
  width: number,
): void {
  graphics
    .moveTo(-radius, -radius)
    .lineTo(radius, radius)
    .moveTo(radius, -radius)
    .lineTo(-radius, radius)
    .stroke({ color, width, cap: 'round' });
}

function drawWeb(graphics: Graphics, color: string | number, width: number): void {
  const angles = [-1.57, -0.82, -0.08, 0.7, 1.52, 2.31, 3.08, 3.88];
  const radii = [10.5, 9.6, 10.2, 9.8, 10.6, 9.7, 10.3, 9.5];
  const style = { color, width, cap: 'round' as const, join: 'round' as const };
  for (let index = 0; index < angles.length; index++) {
    graphics
      .moveTo(Math.cos(angles[index]) * 1.1, Math.sin(angles[index]) * 1.1)
      .lineTo(Math.cos(angles[index]) * radii[index], Math.sin(angles[index]) * radii[index]);
  }
  graphics.stroke(style);
  for (const radius of [3.4, 6.4, 9.2]) {
    const points = angles.map((angle, index) => ({
      x: Math.cos(angle) * Math.min(radius, radii[index]),
      y: Math.sin(angle) * Math.min(radius, radii[index]),
    }));
    graphics.beginPath().moveTo(points[0].x, points[0].y);
    for (let index = 0; index < angles.length; index++) {
      const next = (index + 1) % angles.length;
      const nextAngle = next === 0 ? angles[0] + Math.PI * 2 : angles[next];
      const middle = (angles[index] + nextAngle) / 2;
      graphics.quadraticCurveTo(
        Math.cos(middle) * radius * 0.9,
        Math.sin(middle) * radius * 0.9,
        points[next].x,
        points[next].y,
      );
    }
    graphics.stroke(style);
  }
  graphics.beginPath().circle(0, 0, 1.25).fill(color);
}

const protectionHex = hexPoints(27.1);

/** Clip hatching to the hex once, avoiding per-cell stencil masks and render passes. */
function clipHatch(x1: number, y1: number, x2: number, y2: number): number[] | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let enter = 0;
  let exit = 1;
  for (let index = 0; index < 6; index++) {
    const next = (index + 1) % 6;
    const x = protectionHex[index * 2];
    const y = protectionHex[index * 2 + 1];
    const edgeX = protectionHex[next * 2] - x;
    const edgeY = protectionHex[next * 2 + 1] - y;
    const distance = edgeX * (y1 - y) - edgeY * (x1 - x);
    const slope = edgeX * dy - edgeY * dx;
    if (Math.abs(slope) < 1e-8) {
      if (distance < 0) return null;
      continue;
    }
    const crossing = -distance / slope;
    if (slope > 0) enter = Math.max(enter, crossing);
    else exit = Math.min(exit, crossing);
    if (enter >= exit) return null;
  }
  return [x1 + enter * dx, y1 + enter * dy, x1 + exit * dx, y1 + exit * dy];
}
