import { useEffect, useRef } from 'react';
import { isOnBoard, stepHex } from '../hex';
import { BoardRenderer } from '../renderer';
import type { Direction } from '../types';
import { useGame } from './game-context';

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** React owns the canvas element; the renderer owns pixels and camera motion. */
export function BoardCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { snapshot, commands, session } = useGame();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new BoardRenderer(canvas);
    const detach = session.attachRenderer(renderer);
    const events = new AbortController();
    const options = { signal: events.signal };
    const pointers = new Map<number, PointerState>();
    let previousPinchDistance = 0;
    let previousPinchCenter: { x: number; y: number } | null = null;
    let multiPointerGesture = false;

    const updatePinchBaseline = (): void => {
      const [first, second] = [...pointers.values()];
      if (!first || !second) return;
      previousPinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
      previousPinchCenter = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    };

    canvas.addEventListener(
      'pointerdown',
      (event) => {
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        });
        if (pointers.size >= 2) {
          multiPointerGesture = true;
          for (const pointer of pointers.values()) pointer.moved = true;
          updatePinchBaseline();
        }
      },
      options,
    );

    canvas.addEventListener(
      'pointermove',
      (event) => {
        const pointer = pointers.get(event.pointerId);
        if (!pointer) {
          if (event.pointerType === 'mouse')
            commands.hoverHex(renderer.clientToHex(event.clientX, event.clientY));
          return;
        }
        const oldX = pointer.x;
        const oldY = pointer.y;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5)
          pointer.moved = true;
        if (pointers.size === 1 && pointer.moved) {
          renderer.panBy(pointer.x - oldX, pointer.y - oldY);
        } else if (pointers.size === 2) {
          for (const tracked of pointers.values()) tracked.moved = true;
          const [first, second] = [...pointers.values()];
          const distance = Math.hypot(first.x - second.x, first.y - second.y);
          const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          if (previousPinchDistance > 0)
            renderer.zoomBy(distance / previousPinchDistance, center.x, center.y);
          if (previousPinchCenter)
            renderer.panBy(center.x - previousPinchCenter.x, center.y - previousPinchCenter.y);
          previousPinchDistance = distance;
          previousPinchCenter = center;
        }
      },
      options,
    );

    canvas.addEventListener(
      'pointerup',
      (event) => {
        const pointer = pointers.get(event.pointerId);
        const wasSingle = pointers.size === 1;
        pointers.delete(event.pointerId);
        if (pointer && wasSingle && !pointer.moved && !multiPointerGesture) {
          const hex = renderer.clientToHex(event.clientX, event.clientY);
          if (hex) commands.selectHex(hex);
        }
        if (pointers.size < 2) {
          previousPinchDistance = 0;
          previousPinchCenter = null;
        } else updatePinchBaseline();
        if (pointers.size === 0) multiPointerGesture = false;
      },
      options,
    );

    const cancelPointer = (event: PointerEvent): void => {
      pointers.delete(event.pointerId);
      previousPinchDistance = 0;
      previousPinchCenter = null;
      if (pointers.size === 0) multiPointerGesture = false;
    };
    canvas.addEventListener('pointercancel', cancelPointer, options);
    canvas.addEventListener('lostpointercapture', cancelPointer, options);
    canvas.addEventListener(
      'pointerleave',
      () => {
        if (pointers.size === 0) commands.hoverHex(null);
      },
      options,
    );
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        renderer.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
      },
      { ...options, passive: false },
    );

    canvas.addEventListener(
      'keydown',
      (event) => {
        const current = session.getSnapshot();
        const shortcut = event.key.toLowerCase();
        if (shortcut === 'h') {
          event.preventDefault();
          commands.openDialog({ kind: 'rules' });
          return;
        }
        if (shortcut === 'l') {
          event.preventDefault();
          commands.setLogOpen(!current.logOpen);
          document.getElementById('log-toggle')?.focus();
          return;
        }
        if (shortcut === 'c') {
          event.preventDefault();
          renderer.resetView();
          commands.announce('Tablero centrado.');
          return;
        }
        if (shortcut === 'u') {
          event.preventDefault();
          const units = current.state.pieces
            .filter((piece) => piece.owner === current.state.activePlayer)
            .sort((a, b) => a.id.localeCompare(b.id));
          if (units.length) {
            const index = units.findIndex((piece) => piece.id === current.selectedId);
            commands.selectPiece(
              units[(index + (event.shiftKey ? -1 : 1) + units.length) % units.length].id,
            );
          }
          return;
        }
        const directions: Record<string, Direction> = {
          q: 4,
          w: 3,
          e: 2,
          a: 5,
          s: 0,
          d: 1,
          '7': 4,
          '8': 3,
          '9': 2,
          '4': 5,
          '2': 0,
          '6': 1,
        };
        const modelDirection = directions[shortcut];
        if (modelDirection !== undefined) {
          event.preventDefault();
          const direction = ((modelDirection + (current.viewPlayer === 0 ? 0 : 3)) %
            6) as Direction;
          const next = stepHex(current.focusedHex ?? { q: 0, r: 0 }, direction);
          if (isOnBoard(next)) {
            commands.focusHex(next);
            commands.announceCell(next);
          }
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (current.focusedHex) commands.selectHex(current.focusedHex);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (current.pendingAction || (current.selectedId && current.mode.kind !== 'default'))
            commands.cancelDraft();
        }
      },
      options,
    );

    return () => {
      events.abort();
      pointers.clear();
      detach();
      renderer.destroy();
    };
  }, [commands, session]);

  const focused = snapshot.focusedHex;
  return (
    <div className="canvas-wrap" id="canvas-wrap">
      <canvas
        ref={canvasRef}
        id="game-canvas"
        tabIndex={0}
        role="grid"
        aria-label="Tablero hexagonal interactivo"
        aria-rowcount={11}
        aria-colcount={11}
        aria-owns="sr-board"
        aria-activedescendant={focused ? `hex-cell-${focused.q + 5}-${focused.r + 5}` : undefined}
      />
      <div className="canvas-hint" id="canvas-hint" aria-hidden="true" />
    </div>
  );
}
