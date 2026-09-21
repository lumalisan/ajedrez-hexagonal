interface Position {
  x: number;
  y: number;
}

interface Drag {
  pointerId: number;
  pointer: Position;
  origin: Position;
  previousPosition: Position | null;
}

interface FloatingCommandPanelElements {
  arena: HTMLElement;
  panel: HTMLElement;
  titlebar: HTMLElement;
  minimize: HTMLButtonElement;
  close: HTMLButtonElement;
  restore: HTMLButtonElement;
}

/** Keeps desktop window placement separate from the selected unit and its draft order. */
export class FloatingCommandPanel {
  private readonly desktop = window.matchMedia('(min-width: 901px)');
  private readonly events = new AbortController();
  private readonly observer: ResizeObserver;
  private visible = false;
  private minimized = false;
  private position: Position | null = null;
  private drag: Drag | null = null;

  constructor(
    private readonly elements: FloatingCommandPanelElements,
    private readonly onClose: () => void,
  ) {
    const { titlebar, minimize, close, restore, arena, panel } = elements;
    const options = { signal: this.events.signal };
    titlebar.addEventListener('pointerdown', this.startDrag, options);
    titlebar.addEventListener('pointermove', this.moveDrag, options);
    titlebar.addEventListener('pointerup', this.endDrag, options);
    titlebar.addEventListener('pointercancel', this.cancelDrag, options);
    titlebar.addEventListener('lostpointercapture', this.endDrag, options);
    titlebar.addEventListener('keydown', this.moveWithKeyboard, options);
    minimize.addEventListener('click', this.minimize, options);
    close.addEventListener('click', this.close, options);
    restore.addEventListener('click', this.restore, options);
    this.desktop.addEventListener('change', this.changeLayout, options);
    this.observer = new ResizeObserver(() => this.place());
    this.observer.observe(arena);
    this.observer.observe(panel);
    this.sync();
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      this.finishDrag();
      this.minimized = false;
    }
    this.visible = visible;
    this.sync();
  }

  reveal(): void {
    this.minimized = false;
    this.sync();
  }

  destroy(): void {
    this.finishDrag();
    this.events.abort();
    this.observer.disconnect();
  }

  private sync(): void {
    const { panel, restore, titlebar } = this.elements;
    const minimized = this.visible && this.desktop.matches && this.minimized;
    panel.hidden = !this.visible || minimized;
    restore.hidden = !minimized;
    titlebar.tabIndex = this.desktop.matches ? 0 : -1;
    if (!panel.hidden) this.place();
  }

  private place(): void {
    const { arena, panel } = this.elements;
    if (!this.desktop.matches || panel.hidden || arena.clientWidth === 0) return;
    const margin = 12;
    const maxX = Math.max(margin, arena.clientWidth - panel.offsetWidth - margin);
    const maxY = Math.max(margin, arena.clientHeight - panel.offsetHeight - margin);
    const desired = this.position ?? {
      x: arena.clientWidth - panel.offsetWidth - 24,
      y: 24,
    };
    const x = Math.max(margin, Math.min(maxX, desired.x));
    const y = Math.max(margin, Math.min(maxY, desired.y));
    // A default window remains right-aligned on resize until the user moves it.
    if (this.position) this.position = { x, y };
    panel.style.setProperty('--command-window-x', `${x}px`);
    panel.style.setProperty('--command-window-y', `${y}px`);
  }

  private currentPosition(): Position {
    const { panel } = this.elements;
    return { x: panel.offsetLeft, y: panel.offsetTop };
  }

  private minimize = (): void => {
    if (!this.visible || !this.desktop.matches) return;
    this.finishDrag();
    this.position = this.currentPosition();
    this.minimized = true;
    this.sync();
    this.elements.restore.focus({ preventScroll: true });
  };

  private restore = (): void => {
    this.reveal();
    this.elements.titlebar.focus({ preventScroll: true });
  };

  private close = (): void => {
    this.finishDrag();
    this.position = null;
    this.minimized = false;
    this.onClose();
  };

  private changeLayout = (): void => {
    const { restore, titlebar } = this.elements;
    const focusWasInWindowControls =
      document.activeElement === restore || titlebar.contains(document.activeElement);
    this.finishDrag();
    this.sync();
    if (!this.desktop.matches && this.visible && focusWasInWindowControls) {
      this.elements.close.focus({ preventScroll: true });
    }
  };

  private startDrag = (event: PointerEvent): void => {
    if (!this.desktop.matches || event.button !== 0 || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    this.drag = {
      pointerId: event.pointerId,
      pointer: { x: event.clientX, y: event.clientY },
      origin: this.currentPosition(),
      previousPosition: this.position,
    };
    this.elements.titlebar.setPointerCapture(event.pointerId);
    this.elements.titlebar.focus({ preventScroll: true });
    this.elements.panel.classList.add('is-dragging');
    event.preventDefault();
  };

  private moveDrag = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.position = {
      x: this.drag.origin.x + event.clientX - this.drag.pointer.x,
      y: this.drag.origin.y + event.clientY - this.drag.pointer.y,
    };
    this.place();
  };

  private endDrag = (event: PointerEvent): void => {
    if (event.pointerId === this.drag?.pointerId) this.finishDrag();
  };

  private cancelDrag = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.position = this.drag.previousPosition;
    this.finishDrag();
    this.place();
  };

  private finishDrag(): void {
    const drag = this.drag;
    this.drag = null;
    this.elements.panel.classList.remove('is-dragging');
    if (drag && this.elements.titlebar.hasPointerCapture(drag.pointerId)) {
      this.elements.titlebar.releasePointerCapture(drag.pointerId);
    }
  }

  private moveWithKeyboard = (event: KeyboardEvent): void => {
    if (!this.desktop.matches || event.target !== this.elements.titlebar) return;
    if (event.key === 'Escape' && this.drag) {
      this.position = this.drag.previousPosition;
      this.finishDrag();
      this.place();
    } else {
      const vectors: Record<string, Position> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const vector = vectors[event.key];
      if (!vector) return;
      const distance = event.shiftKey ? 40 : 10;
      const current = this.currentPosition();
      this.position = { x: current.x + vector.x * distance, y: current.y + vector.y * distance };
      this.place();
    }
    event.preventDefault();
    event.stopPropagation();
  };
}
