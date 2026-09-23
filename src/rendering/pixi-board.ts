import { Container, FillGradient, Graphics, GraphicsContext, Text } from 'pixi.js';
import { ALL_DIRECTIONS, allBoardHexes, equalHex, hexDistance, hexToWorld } from '../hex';
import { getPiece, isAirPiece } from '../engine';
import type { GameEvent, GameState, Hex } from '../types';
import {
  COLORS,
  TILE_DEPTH,
  boardDepthVector,
  boardTilt,
  movementPose,
  projectHex,
  signed,
  type RenderModel,
} from './model';
import { PixiOverlays } from './pixi-overlays';
import { PixiPiece } from './pixi-piece';
import { PixiTutorialCue } from './pixi-tutorial-cue';
import { boardOutlinePoints, hexPoints, strokeDashedPath } from './shapes';

export interface BoardAnimation {
  events: GameEvent[];
  before: GameState;
  startedAt: number;
  duration: number;
}

interface SceneView {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  zoom: number;
  orientation: number;
  depth: number;
  idleTime?: number;
  frame: { x: number; y: number; width: number; height: number } | null;
}

/** Retained GPU scene. Camera and piece motion change transforms, not game state. */
export class PixiBoard {
  private readonly backdrop = new Graphics();
  private backdropGradient: FillGradient | null = null;
  private backdropSize = '';
  private readonly camera = new Container();
  private readonly content = new Container();
  private readonly frameMask = new Graphics();
  private frameKey = '';
  private readonly tilt = new Container();
  private readonly board = new Container();
  private readonly shadow = new Graphics();
  private readonly sides = new Container();
  private readonly tiles = new Container();
  private readonly coordinates = new Container();
  private readonly tileContexts: GraphicsContext[] = [];
  private readonly overlays = new PixiOverlays();
  private readonly tutorialCue = new PixiTutorialCue();
  private readonly stackBases = new Graphics();
  private readonly pieces = new Container({ sortableChildren: true });
  private readonly badges = new Container();
  private readonly effects = new Graphics();
  private readonly movingPieces = new Container();
  private readonly pieceViews = new Map<string, PixiPiece>();
  private readonly badgeViews: Container[] = [];
  private stackKey = '';
  private highContrast: boolean | null = null;

  constructor(stage: Container) {
    stage.eventMode = 'none';
    stage.interactiveChildren = false;
    stage.addChild(this.backdrop, this.camera, this.tutorialCue.screen);
    this.camera.addChild(this.content, this.frameMask);
    this.content.addChild(
      this.tilt,
      this.stackBases,
      this.pieces,
      this.badges,
      this.overlays.targets,
      this.movingPieces,
      this.effects,
    );
    this.tilt.addChild(this.board);
    this.board.addChild(
      this.shadow,
      this.sides,
      this.tiles,
      this.coordinates,
      this.overlays.board,
      this.tutorialCue.board,
    );
    const outline = boardOutlinePoints();
    // Feather the actual perimeter: strongest at the tile edge, transparent 24 units outside.
    // The tiles cover the inward half of each stroke; no filled hexagon bridges the notches.
    const shadowLayers = 24;
    const layerAlpha = 1 - (1 - 0.68) ** (1 / shadowLayers);
    for (let layer = 0; layer < shadowLayers; layer++) {
      this.shadow.poly(outline).stroke({
        color: '#00060a',
        alpha: layerAlpha,
        width: (shadowLayers - layer) * 2,
        join: 'round',
      });
    }
    for (const cell of allBoardHexes()) {
      const point = hexToWorld(cell);
      const label = new Text({
        text: `${signed(cell.q)} ${signed(cell.r)}`,
        style: {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: 5.6,
          fontWeight: '500',
          fill: COLORS.muted,
        },
        resolution: 3,
      });
      label.anchor.set(0.5, 1);
      label.position.set(point.x, point.y + 21);
      label.alpha = 0.52;
      this.coordinates.addChild(label);
    }
  }

  update(
    model: RenderModel | null,
    time: number,
    view: SceneView,
    animation: BoardAnimation | null,
  ): void {
    this.updateBackdrop(view.width, view.height);
    this.content.visible = model !== null;
    this.tutorialCue.update(model, view);
    if (!model) return;
    this.camera.position.set(view.x, view.y);
    this.camera.scale.set(view.scale);
    this.updateFrame(view.frame);
    const tilt = boardTilt(view.depth);
    this.tilt.scale.y = tilt;
    this.board.rotation = view.orientation;
    const sideOffset = boardDepthVector(view.orientation, TILE_DEPTH * view.depth, tilt);
    this.sides.position.set(sideOffset.x, sideOffset.y);
    const shadowOffset = boardDepthVector(view.orientation, 16 * view.depth, tilt);
    this.shadow.position.set(shadowOffset.x, shadowOffset.y);
    this.updateTiles(model.highContrast);
    this.coordinates.visible = view.zoom > 1.42;
    if (this.coordinates.visible)
      for (const label of this.coordinates.children) {
        label.rotation = -view.orientation;
        label.scale.y = 1 / tilt;
      }
    this.overlays.update(model, time, view.orientation, view.depth);
    this.updatePieces(model, view, animation, time);
    this.updateEffects(animation, view, time);
  }

  /** Scene objects are destroyed by the surface; shared contexts/gradients are owned here. */
  destroy(): void {
    this.overlays.destroy();
    this.backdropGradient?.destroy();
    for (const context of this.tileContexts) context.destroy();
  }

  private updateBackdrop(width: number, height: number): void {
    const key = `${width}:${height}`;
    if (key === this.backdropSize) return;
    this.backdropSize = key;
    this.backdrop.clear();
    this.backdropGradient?.destroy();
    this.backdropGradient = new FillGradient({
      type: 'radial',
      textureSpace: 'global',
      center: { x: width * 0.48, y: height * 0.42 },
      outerCenter: { x: width * 0.48, y: height * 0.42 },
      outerRadius: Math.max(width, height) * 0.78,
      colorStops: [
        { offset: 0, color: '#102a33' },
        { offset: 0.62, color: COLORS.background },
        { offset: 1, color: '#040b10' },
      ],
    });
    this.backdrop.rect(0, 0, width, height).fill(this.backdropGradient);
    for (let x = -height; x < width + height; x += 28) {
      this.backdrop.moveTo(x, 0).lineTo(x - height, height);
    }
    this.backdrop.stroke({ color: '#7ca0a7', alpha: 0.12, width: 0.5 });
  }

  private updateFrame(frame: SceneView['frame']): void {
    const key = frame ? `${frame.x}:${frame.y}:${frame.width}:${frame.height}` : '';
    if (key === this.frameKey) return;
    this.frameKey = key;
    this.content.mask = null;
    this.frameMask.clear();
    if (frame) {
      this.frameMask
        .rect(frame.x - frame.width / 2, frame.y - frame.height / 2, frame.width, frame.height)
        .fill(0xffffff);
      this.content.mask = this.frameMask;
    }
  }

  private updateTiles(highContrast: boolean): void {
    if (highContrast === this.highContrast) return;
    this.highContrast = highContrast;
    for (const child of this.sides.removeChildren()) child.destroy();
    for (const child of this.tiles.removeChildren()) child.destroy();
    for (const context of this.tileContexts.splice(0)) context.destroy();
    const rings = Array.from({ length: 6 }, (_, ring) => {
      const face = new GraphicsContext()
        .poly(hexPoints(28.9))
        .fill(ring % 2 === 0 ? COLORS.cellA : COLORS.cellB)
        .stroke({
          color: highContrast ? '#9eb2b4' : COLORS.grid,
          alpha: highContrast ? 0.72 : 0.42,
          width: highContrast ? 1.25 : 0.75,
        });
      if (ring > 0)
        face
          .beginPath()
          .arc(0, 0, 19 + ring * 0.45, Math.PI * 0.12, Math.PI * 0.9)
          .stroke({
            color: ring % 2 ? COLORS.amber : COLORS.blue,
            alpha: 0.08 + ring * 0.008,
            width: 0.65,
          });
      else
        for (let radius = 5; radius <= 13; radius += 4)
          face.poly(hexPoints(radius)).stroke({ color: '#89a8aa', alpha: 0.3, width: 1 });
      const side = new GraphicsContext()
        .poly(hexPoints(28.9))
        .fill(ring % 2 === 0 ? '#071a22' : '#092029')
        .stroke({
          color: '#27434b',
          alpha: highContrast ? 0.9 : 0.72,
          width: highContrast ? 1.4 : 0.9,
        });
      this.tileContexts.push(face, side);
      return { face, side };
    });
    for (const cell of allBoardHexes()) {
      const { face, side } = rings[hexDistance({ q: 0, r: 0 }, cell)];
      const position = hexToWorld(cell);
      this.tiles.addChild(new Graphics({ context: face, position }));
      this.sides.addChild(new Graphics({ context: side, position }));
    }
  }

  private updatePieces(
    model: RenderModel,
    view: SceneView,
    animation: BoardAnimation | null,
    time: number,
  ): void {
    const stacked = model.state.pieces
      .filter(isAirPiece)
      .filter((air) =>
        model.state.pieces.some(
          (ground) => !isAirPiece(ground) && equalHex(ground.position, air.position),
        ),
      )
      .map((piece) => piece.position);
    this.updateStacks(stacked, model.highContrast, view);
    const desired = new Set<string>();
    const raw = animation
      ? Math.min(1, Math.max(0, (time - animation.startedAt) / animation.duration))
      : 0;
    const moved = new Map(
      animation?.events
        .filter((event) => event.type === 'move' && event.pieceId)
        .map((event) => [event.pieceId, event]) ?? [],
    );
    const visiblePieces = [...model.state.pieces];
    if (animation)
      for (const id of moved.keys()) {
        if (id && !getPiece(model.state, id)) {
          const before = getPiece(animation.before, id);
          if (before) visiblePieces.push(before);
        }
      }
    for (const current of visiblePieces) {
      const move = moved.get(current.id);
      const moving = Boolean(animation && move?.from && move.to);
      const transformed = animation?.events.some(
        (event) => event.type === 'transform' && event.pieceId === current.id,
      );
      const piece =
        moving && !transformed ? (getPiece(animation!.before, current.id) ?? current) : current;
      const survives = Boolean(getPiece(model.state, piece.id));
      let node = this.pieceViews.get(piece.id);
      if (!node) {
        node = new PixiPiece();
        this.pieceViews.set(piece.id, node);
      }
      const layer = moving ? this.movingPieces : this.pieces;
      if (node.parent !== layer) layer.addChild(node);
      const isStacked = !moving && stacked.some((hex) => equalHex(hex, piece.position));
      const point = projectHex(piece.position, view.orientation, view.depth);
      const row = point.y;
      let glyphRotation = 0;
      if (moving && move?.from && move.to) {
        const pose = movementPose(
          piece,
          move.from,
          move.to,
          survives ? raw : Math.min(1, raw / 0.75),
        );
        const from = projectHex(move.from, view.orientation, view.depth);
        const to = projectHex(move.to, view.orientation, view.depth);
        point.x = from.x + (to.x - from.x) * pose.travel;
        point.y = from.y + (to.y - from.y) * pose.travel - Math.sin(pose.travel * Math.PI) * 4;
        glyphRotation = pose.rotation;
      } else if (isStacked) {
        point.x += isAirPiece(piece) ? 4 : -4;
        point.y += isAirPiece(piece) ? 0 : 3;
      }
      node.position.set(point.x, point.y);
      // A stack's ground offset must not paint it above the aircraft sharing its cell.
      node.zIndex = row + (isAirPiece(piece) ? 0.001 : 0);
      node.update(piece, {
        selected: !moving && piece.id === model.selectedId,
        highContrast: model.highContrast,
        alpha: survives ? 1 : 1 - Math.max(0, (raw - 0.75) / 0.25),
        isStacked,
        orientation: view.orientation,
        glyphRotation,
        fortressMaxHp: model.fortressMaxHp[piece.owner],
        idleTime: view.idleTime,
        depth: view.depth,
      });
      desired.add(piece.id);
    }
    for (const [id, node] of this.pieceViews)
      if (!desired.has(id)) {
        node.removeFromParent();
        node.destroy({ children: true });
        this.pieceViews.delete(id);
      }
  }

  private updateStacks(stacked: Hex[], highContrast: boolean, view: SceneView): void {
    const key = `${highContrast}:${view.orientation}:${view.depth}:${stacked.map((hex) => `${hex.q},${hex.r}`).join(';')}`;
    if (key === this.stackKey) return;
    this.stackKey = key;
    this.stackBases.clear();
    for (const badge of this.badgeViews) badge.visible = false;
    stacked.forEach((hex, index) => {
      const point = projectHex(hex, view.orientation, view.depth);
      this.stackBases.ellipse(point.x, point.y + 4, 25, 8).fill({ color: '#050f14', alpha: 0.82 });
      strokeDashedPath(
        this.stackBases,
        Array.from({ length: 48 }, (_, index) => {
          const angle = (index * Math.PI) / 24;
          return [point.x + Math.cos(angle) * 25, point.y + 4 + Math.sin(angle) * 8];
        }).flat(),
        3,
        2,
        {
          color: highContrast ? COLORS.text : COLORS.move,
          width: highContrast ? 2 : 1.25,
        },
        true,
      );
      let badge = this.badgeViews[index];
      if (!badge) {
        badge = new Container();
        badge.addChild(new Graphics().circle(0, 0, 8).fill(0xffffff));
        const text = new Text({
          text: '2',
          style: {
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: 10,
            fontWeight: '700',
            fill: COLORS.background,
          },
          resolution: 3,
        });
        text.anchor.set(0.5);
        text.y = 0.5;
        badge.addChild(text);
        this.badges.addChild(badge);
        this.badgeViews.push(badge);
      }
      badge.children[0].tint = highContrast ? COLORS.text : COLORS.move;
      badge.position.set(point.x + 21, point.y - 29);
      badge.visible = true;
    });
  }

  private updateEffects(animation: BoardAnimation | null, view: SceneView, time: number): void {
    const graphics = this.effects;
    graphics.clear();
    if (!animation) return;
    const raw = Math.min(1, Math.max(0, (time - animation.startedAt) / animation.duration));
    const eased = 1 - (1 - raw) ** 3;
    for (const event of animation.events) {
      if (event.type === 'shoot' && event.from && event.to) {
        const from = projectHex(event.from, view.orientation, view.depth);
        const to = projectHex(event.to, view.orientation, view.depth);
        strokeDashedPath(
          graphics,
          [
            from.x,
            from.y,
            from.x + (to.x - from.x) * Math.min(1, raw * 1.8),
            from.y + (to.y - from.y) * Math.min(1, raw * 1.8),
          ],
          7,
          3,
          { color: COLORS.attack, alpha: Math.sin(raw * Math.PI), width: 2.2 },
        );
      }
      if (!event.at) continue;
      const at = projectHex(event.at, view.orientation, view.depth);
      if (event.type === 'destroy' || event.type === 'intercept') {
        const progress = animation.events.some((candidate) => candidate.type === 'move')
          ? Math.max(0, (raw - 0.75) / 0.25)
          : raw;
        const style = {
          color: event.type === 'intercept' ? COLORS.danger : COLORS.attack,
          alpha: Math.sin(progress * Math.PI),
          width: 2,
        };
        graphics.circle(at.x, at.y, 5 + eased * 22).stroke(style);
        for (const direction of ALL_DIRECTIONS) {
          const angle = -Math.PI / 2 + (direction * Math.PI) / 3;
          graphics
            .moveTo(at.x + Math.cos(angle) * 7, at.y + Math.sin(angle) * 7)
            .lineTo(
              at.x + Math.cos(angle) * (10 + eased * 15),
              at.y + Math.sin(angle) * (10 + eased * 15),
            )
            .stroke(style);
        }
      }
      if (
        event.type === 'convert' ||
        event.type === 'fortressDamage' ||
        event.type === 'transform'
      ) {
        // Rotate each shape locally before placing it at the impact cell.
        // Pixi's draw-time rotation also rotates any existing translation.
        graphics
          .save()
          .rotateTransform(raw * Math.PI * 0.6)
          .translateTransform(at.x, at.y)
          .poly(hexPoints(18 + eased * 10))
          .stroke({
            color: event.type === 'fortressDamage' ? COLORS.attack : COLORS.convert,
            alpha: Math.sin(raw * Math.PI) * 0.9,
            width: 2.3,
          })
          .restore();
        if (event.type === 'fortressDamage') {
          graphics
            .save()
            .rotateTransform(-raw * Math.PI * 0.55)
            .translateTransform(at.x, at.y)
            .poly(hexPoints(27 + eased * 24))
            .stroke({ color: COLORS.amber, alpha: Math.sin(raw * Math.PI) * 0.62, width: 1.35 })
            .restore();
          graphics
            .save()
            .rotateTransform(raw * Math.PI * 1.85)
            .translateTransform(at.x, at.y);
          strokeDashedPath(
            graphics,
            hexPoints(38 + eased * 35),
            3,
            5,
            { color: COLORS.amber, alpha: Math.sin(raw * Math.PI) * 0.62, width: 1.35 },
            true,
          );
          graphics.restore();
        }
      }
    }
  }
}
