import './styles.css';

import { AudioDirector } from './audio';
import {
  ALL_DIRECTIONS,
  DIRECTION_NAMES,
  equalHex,
  hexKey,
  isOnBoard,
  stepHex,
} from './hex';
import {
  PIECE_NAMES,
  PLAYER_NAMES,
  applyAction,
  createInitialState,
  declareBlockade,
  describeAction,
  getLegalActionsForPiece,
  getPiece,
  occupancyAt,
  outcomeText,
} from './engine';
import {
  BoardRenderer,
  actionsAtHex,
  pieceAccessibleLabel,
  type RenderModel,
} from './renderer';
import type { Direction, GameAction, GameEvent, GamePreferences, Hex, Piece } from './types';

type UiMode =
  | { kind: 'default' }
  | { kind: 'rotate' }
  | { kind: 'orient' }
  | { kind: 'transform'; facing: Direction | null }
  | { kind: 'actionChoice'; actions: GameAction[] }
  | { kind: 'pieceChoice'; pieceIds: string[] };

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const canvas = requireElement<HTMLCanvasElement>('game-canvas');
const renderer = new BoardRenderer(canvas);
let preferences = loadPreferences();
const audio = new AudioDirector(preferences);
audio.setEnabled(preferences.sound);

let state = createInitialState();
let selectedId: string | null = null;
let pendingAction: GameAction | null = null;
let mode: UiMode = { kind: 'default' };
let hoveredHex: Hex | null = null;
let focusedHex: Hex | null = { q: 0, r: 0 };
let visibleActions: GameAction[] = [];
let lastEvents: GameEvent[] = [];
let animating = false;
let logOpen = false;
let renderedStatusKey = '';

const pointers = new Map<number, PointerState>();
let previousPinchDistance = 0;
let previousPinchCenter: { x: number; y: number } | null = null;
let multiPointerGesture = false;

const pieceCard = requireElement<HTMLElement>('piece-card');
const actionControls = requireElement<HTMLElement>('action-controls');
const pendingCard = requireElement<HTMLElement>('pending-card');
const selectionSummary = requireElement<HTMLElement>('selection-summary');
const turnChip = requireElement<HTMLElement>('turn-chip');
const blueFortress = requireElement<HTMLElement>('blue-fortress');
const amberFortress = requireElement<HTMLElement>('amber-fortress');
const battleLog = requireElement<HTMLOListElement>('battle-log');
const logToggle = requireElement<HTMLButtonElement>('log-toggle');
const soundButton = requireElement<HTMLButtonElement>('sound-button');
const blockadeButton = requireElement<HTMLButtonElement>('blockade-button');
const mobileNewGameButton = requireElement<HTMLButtonElement>('mobile-new-game-button');
const dialog = requireElement<HTMLDialogElement>('game-dialog');
const toastRegion = requireElement<HTMLElement>('toast-region');
const announcer = requireElement<HTMLElement>('announcer');
const srBoard = requireElement<HTMLElement>('sr-board');

applyPreferences();
bindControls();
render();

function bindControls(): void {
  requireElement<HTMLButtonElement>('zoom-in').addEventListener('click', () => renderer.zoomBy(1.16));
  requireElement<HTMLButtonElement>('zoom-out').addEventListener('click', () => renderer.zoomBy(1 / 1.16));
  requireElement<HTMLButtonElement>('reset-view').addEventListener('click', () => renderer.resetView());
  requireElement<HTMLButtonElement>('new-game-button').addEventListener('click', showNewGameDialog);
  mobileNewGameButton.addEventListener('click', showNewGameDialog);
  requireElement<HTMLButtonElement>('help-button').addEventListener('click', showHelpDialog);
  requireElement<HTMLButtonElement>('settings-button').addEventListener('click', showSettingsDialog);
  blockadeButton.addEventListener('click', showBlockadeDialog);

  soundButton.addEventListener('click', () => {
    preferences.sound = audio.toggle();
    savePreferences();
    renderSoundButton();
  });

  const activateAudio = (): void => audio.startMusic();
  window.addEventListener('pointerdown', activateAudio, { once: true, capture: true });
  window.addEventListener('keydown', activateAudio, { once: true, capture: true });

  logToggle.addEventListener('click', () => {
    logOpen = !logOpen;
    renderBattleLog();
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) {
      hoveredHex = null;
      syncCanvas();
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      renderer.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', onCanvasKeyDown);

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || dialog.open) return;
    if (pendingAction || mode.kind !== 'default') cancelDraft();
    else if (selectedId) clearSelection();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function onPointerDown(event: PointerEvent): void {
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
    for (const tracked of pointers.values()) tracked.moved = true;
    updatePinchBaseline();
  }
}

function onPointerMove(event: PointerEvent): void {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) {
    if (event.pointerType === 'mouse') {
      hoveredHex = renderer.clientToHex(event.clientX, event.clientY);
      syncCanvas();
    }
    return;
  }

  const oldX = pointer.x;
  const oldY = pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) pointer.moved = true;

  if (pointers.size === 1 && pointer.moved) {
    renderer.panBy(pointer.x - oldX, pointer.y - oldY);
  } else if (pointers.size === 2) {
    for (const tracked of pointers.values()) tracked.moved = true;
    const [first, second] = [...pointers.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    if (previousPinchDistance > 0) {
      renderer.zoomBy(distance / previousPinchDistance, center.x, center.y);
    }
    if (previousPinchCenter) {
      renderer.panBy(center.x - previousPinchCenter.x, center.y - previousPinchCenter.y);
    }
    previousPinchDistance = distance;
    previousPinchCenter = center;
  }
}

function onPointerUp(event: PointerEvent): void {
  const pointer = pointers.get(event.pointerId);
  const wasSingle = pointers.size === 1;
  pointers.delete(event.pointerId);
  if (pointer && wasSingle && !pointer.moved && !multiPointerGesture) {
    const hex = renderer.clientToHex(event.clientX, event.clientY);
    if (hex) handleCell(hex);
  }
  if (pointers.size < 2) {
    previousPinchDistance = 0;
    previousPinchCenter = null;
  } else {
    updatePinchBaseline();
  }
  if (pointers.size === 0) multiPointerGesture = false;
}

function onPointerCancel(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  previousPinchDistance = 0;
  previousPinchCenter = null;
  if (pointers.size === 0) multiPointerGesture = false;
}

function updatePinchBaseline(): void {
  const [first, second] = [...pointers.values()];
  if (!first || !second) return;
  previousPinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
  previousPinchCenter = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function onCanvasKeyDown(event: KeyboardEvent): void {
  const keyDirections: Record<string, Direction> = state.activePlayer === 0
    ? { w: 3, d: 5, s: 0, a: 2 }
    : { w: 0, d: 2, s: 3, a: 5 };
  const direction = keyDirections[event.key.toLowerCase()];
  if (direction !== undefined) {
    event.preventDefault();
    const next = stepHex(focusedHex ?? { q: 0, r: 0 }, direction);
    if (isOnBoard(next)) {
      focusedHex = next;
      announceCell(next);
      renderScreenReaderBoard();
      syncCanvas();
    }
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (focusedHex) handleCell(focusedHex);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (pendingAction || mode.kind !== 'default') cancelDraft();
    else clearSelection();
  }
}

function handleCell(hex: Hex): void {
  if (animating) return;
  focusedHex = hex;
  if (!state.outcome) {
    const matching = actionsAtHex(state, visibleActions, hex);
    if (matching.length === 1) {
      setPending(matching[0]);
      return;
    }
    if (matching.length > 1) {
      mode = { kind: 'actionChoice', actions: matching };
      pendingAction = null;
      render();
      announce('Hay varios objetivos en esa casilla. Elige aire o suelo en el panel.');
      return;
    }
  }

  const occupancy = occupancyAt(state, hex);
  const pieces = [occupancy.ground, occupancy.air].filter((piece): piece is Piece => Boolean(piece));
  if (pieces.length === 0) {
    clearSelection();
  } else if (pieces.length === 1) {
    selectPiece(pieces[0].id);
  } else {
    selectedId = null;
    mode = { kind: 'pieceChoice', pieceIds: pieces.map((piece) => piece.id) };
    pendingAction = null;
    render();
    announce('Casilla apilada. Elige unidad de aire o suelo.');
  }
}

function selectPiece(pieceId: string): void {
  const piece = getPiece(state, pieceId);
  if (!piece) return;
  selectedId = pieceId;
  focusedHex = { ...piece.position };
  pendingAction = null;
  mode = { kind: 'default' };
  audio.playSelect();
  render();
  announce(`${pieceAccessibleLabel(state, piece)}. ${piece.owner === state.activePlayer ? 'Unidad lista.' : 'Unidad rival.'}`);
}

function clearSelection(): void {
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  render();
}

function cancelDraft(): void {
  pendingAction = null;
  mode = { kind: 'default' };
  render();
  announce('Orden cancelada.');
}

function setPending(action: GameAction): void {
  pendingAction = action;
  if (mode.kind === 'actionChoice') mode = { kind: 'default' };
  render();
  announce(`${describeAction(state, action)}. Pulsa confirmar para ejecutar.`);
}

async function commitPending(): Promise<void> {
  if (!pendingAction || animating) return;
  const before = state;
  const result = applyAction(state, pendingAction);
  if (!result.ok) {
    audio.playInvalid();
    showToast(result.error ?? 'Orden rechazada.');
    return;
  }

  state = result.state;
  lastEvents = result.events;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  animating = true;
  audio.playEvents(result.events, before);
  render();
  try {
    await renderer.playEvents(result.events, before, preferences.reducedMotion);
    if (!state.outcome) await renderer.rotateToPlayer(state.activePlayer, preferences.reducedMotion);
  } finally {
    animating = false;
    render();
  }

  if (state.outcome) {
    announce(outcomeText(state.outcome));
    showOutcomeDialog();
  } else {
    audio.playTurn();
    announce(`Turno de ${PLAYER_NAMES[state.activePlayer]}.`);
  }
}

function render(): void {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const restoreDynamicFocus = Boolean(
    activeElement && (actionControls.contains(activeElement) || pendingCard.contains(activeElement)),
  );
  const focusAttribute = activeElement?.getAttributeNames().find((name) => name.startsWith('data-'));
  const focusValue = focusAttribute ? activeElement?.getAttribute(focusAttribute) : null;
  const selected = selectedId ? getPiece(state, selectedId) : undefined;
  if (selectedId && !selected) {
    selectedId = null;
    pendingAction = null;
    mode = { kind: 'default' };
  }
  const legalActions = selectedId ? getLegalActionsForPiece(state, selectedId) : [];
  visibleActions = filterVisibleActions(legalActions, selected);
  renderStatus();
  renderPieceCard(selected);
  renderActionControls(selected, legalActions);
  renderPendingCard(selected, legalActions);
  renderBattleLog();
  renderSoundButton();
  renderScreenReaderBoard();
  syncCanvas();
  if (restoreDynamicFocus) {
    queueMicrotask(() => {
      const selector = focusAttribute && typeof focusValue === 'string'
        ? `[${focusAttribute}="${CSS.escape(focusValue)}"]`
        : '';
      const replacement = selector
        ? document.querySelector<HTMLElement>(selector)
        : null;
      replacement?.focus();
      if (!replacement) {
        pendingCard.querySelector<HTMLElement>('.confirm-button')?.focus();
        if (document.activeElement === activeElement || document.activeElement === document.body) {
          actionControls.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
        }
      }
    });
  }
}

function syncCanvas(): void {
  const model: RenderModel = {
    state,
    selectedId,
    actions: visibleActions,
    pending: pendingAction,
    hovered: hoveredHex,
    focused: focusedHex,
    lastEvents,
    reducedMotion: preferences.reducedMotion,
    highContrast: preferences.highContrast,
  };
  renderer.setModel(model);
}

function filterVisibleActions(actions: GameAction[], selected?: Piece): GameAction[] {
  if (mode.kind === 'actionChoice') return mode.actions;
  if (mode.kind === 'pieceChoice' || mode.kind === 'rotate' || mode.kind === 'orient') return [];
  if (mode.kind === 'transform') {
    if (mode.facing === null) return [];
    const facing = mode.facing;
    return actions.filter(
      (action) =>
        action.kind === 'transform' &&
        action.facing === facing &&
        (Boolean(action.to) || Boolean(action.attackAboveId)),
    );
  }
  return actions.filter((action) => {
    if (action.kind === 'rotate' || action.kind === 'orient' || action.kind === 'transform') return false;
    if (selected?.type === 'medium' && action.kind === 'move') {
      return action.cannon === selected.cannon;
    }
    return true;
  });
}

function renderStatus(): void {
  blockadeButton.disabled = Boolean(state.outcome) || animating;
  const fortressState = state.pieces
    .filter((piece) => piece.type === 'fortress')
    .map((piece) => `${piece.owner}:${piece.hp}`)
    .sort()
    .join('|');
  const statusKey = `${state.activePlayer}:${state.ply}:${fortressState}:${JSON.stringify(state.outcome)}`;
  if (statusKey === renderedStatusKey) return;
  renderedStatusKey = statusKey;
  renderFortressStatus(0, blueFortress);
  renderFortressStatus(1, amberFortress);
  if (state.outcome) {
    turnChip.className = 'turn-chip finished';
    turnChip.innerHTML = `<span>PARTIDA FINALIZADA</span><strong>${escapeHtml(outcomeText(state.outcome))}</strong>`;
  } else {
    const playerClass = state.activePlayer === 0 ? 'blue' : 'amber';
    turnChip.className = `turn-chip ${playerClass}`;
    turnChip.innerHTML = `<span>TURNO ${Math.floor(state.ply / 2) + 1}</span><strong>${PLAYER_NAMES[state.activePlayer]} en mando</strong>`;
  }
}

function renderFortressStatus(player: 0 | 1, element: HTMLElement): void {
  const fortress = state.pieces.find((piece) => piece.type === 'fortress' && piece.owner === player);
  const hp = fortress?.type === 'fortress' ? fortress.hp : 0;
  element.innerHTML = `
    <span class="faction-mark" aria-hidden="true"></span>
    <div><small>${PLAYER_NAMES[player]}</small><strong>Fortaleza</strong></div>
    <span class="hp" aria-label="${hp} de 2 puntos de vida">
      ${[1, 2].map((point) => `<i class="${hp >= point ? 'active' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-8.5-5.2-8.5-12A4.5 4.5 0 0 1 12 6.9 4.5 4.5 0 0 1 20.5 9c0 6.8-8.5 12-8.5 12Z"/></svg></i>`).join('')}
    </span>`;
}

function renderPieceCard(piece?: Piece): void {
  if (!piece) {
    pieceCard.className = 'piece-card empty-state';
    pieceCard.innerHTML = `
      <div class="empty-radar" aria-hidden="true"><i></i><i></i><i></i></div>
      <h2>Esperando selección</h2>
      <p>Toca una unidad. Destinos legales aparecerán directamente sobre el tablero.</p>
      <span class="key-map">Teclado: W A S D · Enter</span>`;
    selectionSummary.textContent = state.outcome
      ? outcomeText(state.outcome)
      : `Turno de ${PLAYER_NAMES[state.activePlayer]}. Selecciona una unidad propia.`;
    return;
  }

  const ownTurn = piece.owner === state.activePlayer && !state.outcome;
  const facing = piece.type === 'soldier'
    ? `<span>Orientación <strong>${DIRECTION_NAMES[piece.facing]}</strong></span>`
    : piece.type === 'medium'
      ? `<span>Cañón <strong>${DIRECTION_NAMES[piece.cannon]}</strong></span>`
      : piece.type === 'fortress'
        ? `<span>Integridad <strong>${piece.hp}/2 HP</strong></span>`
        : '';
  const layer = piece.type === 'drone' ? 'Aire' : 'Suelo';
  const q = piece.position.q >= 0 ? `+${piece.position.q}` : `${piece.position.q}`;
  const r = piece.position.r >= 0 ? `+${piece.position.r}` : `${piece.position.r}`;
  pieceCard.className = `piece-card player-${piece.owner === 0 ? 'blue' : 'amber'}`;
  pieceCard.innerHTML = `
    <div class="piece-title-row">
      <div class="piece-monogram">${pieceMonogram(piece)}</div>
      <div><span class="eyebrow">${PLAYER_NAMES[piece.owner]} · ${layer}</span><h2>${PIECE_NAMES[piece.type]}</h2></div>
      <span class="unit-state ${ownTurn ? 'ready' : ''}">${ownTurn ? 'LISTA' : 'INSPECCIÓN'}</span>
    </div>
    <p>${pieceDescription(piece)}</p>
    <div class="piece-stats"><span>Coordenadas <strong>${q}, ${r}</strong></span>${facing}</div>`;
  selectionSummary.textContent = ownTurn
    ? `${PIECE_NAMES[piece.type]} seleccionada · elige una orden o un destino marcado.`
    : `${PIECE_NAMES[piece.type]} de ${PLAYER_NAMES[piece.owner]} · inspección táctica.`;
}

function renderActionControls(piece: Piece | undefined, legalActions: GameAction[]): void {
  if (mode.kind === 'pieceChoice') {
    actionControls.innerHTML = `<div class="control-section"><h3>Casilla apilada</h3><p>Selecciona capa para inspeccionar.</p><div class="choice-list">${mode.pieceIds
      .map((id) => {
        const candidate = getPiece(state, id);
        return candidate
          ? `<button type="button" data-piece-choice="${id}"><span>${candidate.type === 'drone' ? 'AIRE' : 'SUELO'}</span><strong>${PIECE_NAMES[candidate.type]}</strong></button>`
          : '';
      })
      .join('')}</div></div>`;
    actionControls.querySelectorAll<HTMLButtonElement>('[data-piece-choice]').forEach((button) => {
      button.addEventListener('click', () => selectPiece(button.dataset.pieceChoice ?? ''));
    });
    return;
  }
  if (!piece) {
    actionControls.innerHTML = '';
    return;
  }
  if (mode.kind === 'actionChoice') {
    actionControls.innerHTML = `<div class="control-section"><h3>Elegir objetivo</h3><p>El ataque afecta una sola capa.</p><div class="choice-list">${mode.actions
      .map((action, index) => targetChoiceMarkup(action, index))
      .join('')}</div><button class="text-button cancel-mode" type="button">Cancelar</button></div>`;
    actionControls.querySelectorAll<HTMLButtonElement>('[data-action-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = mode.kind === 'actionChoice' ? mode.actions[Number(button.dataset.actionChoice)] : undefined;
        if (action) setPending(action);
      });
    });
    actionControls.querySelector<HTMLButtonElement>('.cancel-mode')?.addEventListener('click', cancelDraft);
    return;
  }
  if (mode.kind === 'rotate' || mode.kind === 'orient') {
    const current = piece.type === 'soldier' ? piece.facing : piece.type === 'medium' ? piece.cannon : null;
    const title = mode.kind === 'rotate' ? 'Orientar Soldado' : 'Orientar cañón';
    actionControls.innerHTML = directionPanel(title, current, null, 'direction-order');
    actionControls.querySelectorAll<HTMLButtonElement>('[data-direction-order]').forEach((button) => {
      const direction = Number(button.dataset.directionOrder) as Direction;
      button.addEventListener('click', () => {
        const action = legalActions.find((candidate) =>
          mode.kind === 'rotate'
            ? candidate.kind === 'rotate' && candidate.facing === direction
            : candidate.kind === 'orient' && candidate.cannon === direction,
        );
        if (action) setPending(action);
      });
    });
    actionControls.querySelector<HTMLButtonElement>('.cancel-mode')?.addEventListener('click', cancelDraft);
    return;
  }
  if (mode.kind === 'transform') {
    actionControls.innerHTML = `${directionPanel('Abandonar tanque', null, mode.facing, 'transform-facing')}
      <div class="transform-note"><strong>Movimiento opcional</strong><span>Tras elegir orientación, toca uno de los tres destinos frontales o confirma sin mover.</span></div>`;
    actionControls.querySelectorAll<HTMLButtonElement>('[data-transform-facing]').forEach((button) => {
      button.addEventListener('click', () => {
        const facing = Number(button.dataset.transformFacing) as Direction;
        mode = { kind: 'transform', facing };
        pendingAction = legalActions.find(
          (action) => action.kind === 'transform' && action.facing === facing && !action.to && !action.attackAboveId,
        ) ?? null;
        render();
      });
    });
    actionControls.querySelector<HTMLButtonElement>('.cancel-mode')?.addEventListener('click', cancelDraft);
    return;
  }

  if (piece.owner !== state.activePlayer || state.outcome) {
    actionControls.innerHTML = '<div class="control-section muted-section">Sin órdenes disponibles durante este turno.</div>';
    return;
  }

  const moveCount = uniqueDestinations(legalActions.filter((action) => action.kind === 'move')).length;
  const attackCount = legalActions.filter(
    (action) =>
      action.kind === 'shoot' ||
      action.kind === 'convert' ||
      action.kind === 'attackAbove' ||
      action.kind === 'attackBelow',
  ).length;
  const canRotate = legalActions.some((action) => action.kind === 'rotate');
  const canOrient = legalActions.some((action) => action.kind === 'orient');
  const canTransform = legalActions.some((action) => action.kind === 'transform');
  const above = legalActions.find((action) => action.kind === 'attackAbove');
  const below = legalActions.find((action) => action.kind === 'attackBelow');

  actionControls.innerHTML = `
    <div class="control-section">
      <div class="order-overview">
        <span><strong>${moveCount}</strong> destinos</span>
        <span><strong>${attackCount}</strong> objetivos</span>
      </div>
      <p class="order-hint">Toca un marcador del tablero para preparar la orden.</p>
      <div class="command-buttons">
        ${canRotate ? '<button type="button" data-command="rotate">Girar unidad</button>' : ''}
        ${canOrient ? '<button type="button" data-command="orient">Orientar cañón</button>' : ''}
        ${above ? '<button type="button" data-command="above">Atacar Dron superior</button>' : ''}
        ${below ? '<button type="button" data-command="below">Atacar unidad inferior</button>' : ''}
        ${canTransform ? '<button type="button" class="danger-command" data-command="transform">Abandonar tanque</button>' : ''}
      </div>
    </div>`;
  actionControls.querySelector('[data-command="rotate"]')?.addEventListener('click', () => {
    mode = { kind: 'rotate' };
    pendingAction = null;
    render();
  });
  actionControls.querySelector('[data-command="orient"]')?.addEventListener('click', () => {
    mode = { kind: 'orient' };
    pendingAction = null;
    render();
  });
  actionControls.querySelector('[data-command="above"]')?.addEventListener('click', () => {
    if (above) setPending(above);
  });
  actionControls.querySelector('[data-command="below"]')?.addEventListener('click', () => {
    if (below) setPending(below);
  });
  actionControls.querySelector('[data-command="transform"]')?.addEventListener('click', () => {
    mode = { kind: 'transform', facing: null };
    pendingAction = null;
    render();
  });
}

function renderPendingCard(piece: Piece | undefined, legalActions: GameAction[]): void {
  const action = pendingAction;
  if (!action) {
    pendingCard.hidden = true;
    pendingCard.innerHTML = '';
    return;
  }
  pendingCard.hidden = false;
  const mediumMove = piece?.type === 'medium' && action.kind === 'move';
  const cannon = piece?.type === 'medium' && action.kind === 'move' ? action.cannon ?? piece.cannon : null;
  pendingCard.innerHTML = `
    <div class="pending-label"><span>ORDEN PREPARADA</span><i></i></div>
    <strong>${escapeHtml(describeAction(state, action))}</strong>
    ${mediumMove ? `<div class="inline-direction"><span>Cañón tras mover</span>${directionButtons(cannon, 'pending-cannon')}</div>` : ''}
    <div class="pending-actions">
      <button type="button" class="secondary-button cancel-pending">Cancelar</button>
      <button type="button" class="confirm-button" ${animating ? 'disabled' : ''}>Confirmar acción</button>
    </div>`;
  pendingCard.querySelector<HTMLButtonElement>('.cancel-pending')?.addEventListener('click', cancelDraft);
  pendingCard.querySelector<HTMLButtonElement>('.confirm-button')?.addEventListener('click', () => void commitPending());
  pendingCard.querySelectorAll<HTMLButtonElement>('[data-pending-cannon]').forEach((button) => {
    button.addEventListener('click', () => {
      if (pendingAction?.kind !== 'move') return;
      const direction = Number(button.dataset.pendingCannon) as Direction;
      const replacement = legalActions.find(
        (action) =>
          action.kind === 'move' &&
          equalHex(action.to, pendingAction && pendingAction.kind === 'move' ? pendingAction.to : action.to) &&
          action.cannon === direction,
      );
      if (replacement) setPending(replacement);
    });
  });
}

function directionPanel(
  title: string,
  current: Direction | null,
  selected: Direction | null,
  dataName: string,
): string {
  return `<div class="control-section direction-section">
    <h3>${title}</h3>
    <p>Elige una de las seis direcciones.</p>
    <div class="direction-grid">${ALL_DIRECTIONS.map((direction) => {
      const disabled = current === direction;
      const active = selected === direction;
      return `<button type="button" data-${dataName}="${direction}" class="${active ? 'active' : ''}" ${disabled ? 'disabled' : ''} aria-label="${DIRECTION_NAMES[direction]}" aria-pressed="${active || disabled}"><i style="--angle:${direction * 60}deg">↑</i><span>${DIRECTION_NAMES[direction]}</span></button>`;
    }).join('')}</div>
    <button type="button" class="text-button cancel-mode">Volver</button>
  </div>`;
}

function directionButtons(selected: Direction | null, dataName: string): string {
  return `<div class="mini-directions">${ALL_DIRECTIONS.map(
    (direction) => `<button type="button" data-${dataName}="${direction}" class="${selected === direction ? 'active' : ''}" aria-pressed="${selected === direction}">${DIRECTION_NAMES[direction]}</button>`,
  ).join('')}</div>`;
}

function targetChoiceMarkup(action: GameAction, index: number): string {
  const targetId =
    action.kind === 'shoot' ||
    action.kind === 'convert' ||
    action.kind === 'attackAbove' ||
    action.kind === 'attackBelow'
    ? action.targetId
    : action.kind === 'transform'
      ? action.attackAboveId
      : undefined;
  const target = targetId ? getPiece(state, targetId) : undefined;
  const layer = target?.type === 'drone' ? 'AIRE' : 'SUELO';
  return `<button type="button" data-action-choice="${index}"><span>${layer}</span><strong>${target ? PIECE_NAMES[target.type] : 'Objetivo'}</strong></button>`;
}

function renderBattleLog(): void {
  battleLog.hidden = !logOpen;
  logToggle.setAttribute('aria-expanded', String(logOpen));
  logToggle.textContent = logOpen ? 'Ocultar registro' : 'Registro de batalla';
  battleLog.innerHTML = state.history.length
    ? [...state.history]
        .reverse()
        .map(
          (entry) => `<li class="player-${entry.player === 0 ? 'blue' : 'amber'}"><span>${entry.id}</span><p>${escapeHtml(entry.text)}</p></li>`,
        )
        .join('')
    : '<li class="empty-log">Todavía no hay órdenes ejecutadas.</li>';
}

function renderSoundButton(): void {
  soundButton.classList.toggle('muted', !preferences.sound);
  soundButton.setAttribute('aria-label', preferences.sound ? 'Silenciar sonido' : 'Activar sonido');
  soundButton.setAttribute('aria-pressed', String(!preferences.sound));
  soundButton.title = preferences.sound ? 'Silenciar sonido' : 'Activar sonido';
}

function renderScreenReaderBoard(): void {
  const rows: string[] = [];
  for (let r = -5; r <= 5; r += 1) {
    const cells: string[] = [];
    for (let q = -5; q <= 5; q += 1) {
      const hex = { q, r };
      if (!isOnBoard(hex)) continue;
      const occupancy = occupancyAt(state, hex);
      const pieces = [occupancy.ground, occupancy.air]
        .filter((piece): piece is Piece => Boolean(piece))
        .map((piece) => pieceAccessibleLabel(state, piece));
      const legal = [...new Set(actionsAtHex(state, visibleActions, hex).map((action) => describeAction(state, action)))];
      const cellId = accessibleCellId(hex);
      const label = `${pieces.length ? pieces.join('. ') : `Casilla ${q}, ${r}, vacía}`}${legal.length ? `. Acciones legales: ${legal.join('; ')}` : ''}`;
      cells.push(`<div id="${cellId}" role="gridcell" aria-rowindex="${r + 6}" aria-colindex="${q + 6}" aria-selected="${Boolean(focusedHex && equalHex(focusedHex, hex))}" data-hex="${hexKey(hex)}">${escapeHtml(label)}</div>`);
    }
    rows.push(`<div role="row" aria-rowindex="${r + 6}">${cells.join('')}</div>`);
  }
  srBoard.innerHTML = rows.join('');
  if (focusedHex) canvas.setAttribute('aria-activedescendant', accessibleCellId(focusedHex));
  else canvas.removeAttribute('aria-activedescendant');
}

function announceCell(hex: Hex): void {
  const occupancy = occupancyAt(state, hex);
  const pieces = [occupancy.ground, occupancy.air].filter((piece): piece is Piece => Boolean(piece));
  const legal = [...new Set(actionsAtHex(state, visibleActions, hex).map((action) => describeAction(state, action)))];
  announce(
    `${pieces.length
      ? pieces.map((piece) => pieceAccessibleLabel(state, piece)).join('. ')
      : `Casilla ${hex.q}, ${hex.r}, vacía.`}${legal.length ? ` Acciones legales: ${legal.join('; ')}.` : ''}`,
  );
}

function announce(message: string): void {
  announcer.textContent = '';
  window.setTimeout(() => {
    announcer.textContent = message;
  }, 20);
}

function showNewGameDialog(): void {
  openDialog(`
    <div class="dialog-icon">↻</div>
    <span class="eyebrow">NUEVA PARTIDA</span>
    <h2>¿Replegar todas las unidades?</h2>
    <p>Se restaurará el despliegue simétrico inicial. El progreso de esta batalla se perderá.</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-dialog-close>Cancelar</button>
      <button type="button" class="confirm-button" data-new-game>Reiniciar partida</button>
    </div>`);
  dialog.querySelector('[data-new-game]')?.addEventListener('click', () => {
    dialog.close();
    resetGame();
  });
}

function showHelpDialog(): void {
  openDialog(`
    <span class="eyebrow">MANUAL DE CAMPO</span>
    <h2>Destruye la Fortaleza rival</h2>
    <div class="help-grid">
      <section><strong>1 · Selecciona</strong><p>Elige una unidad propia. Menta indica movimiento, rosa ataque, lavanda conversión y naranja intercepción.</p></section>
      <section><strong>2 · Prepara</strong><p>Toca destino. En casillas apiladas podrás elegir aire o suelo. Revisa consecuencia antes de confirmar.</p></section>
      <section><strong>3 · Confirma</strong><p>Cada turno exige una acción. Girar Soldado y orientar cañón también consumen turno.</p></section>
      <section><strong>Victoria</strong><p>Fortaleza tiene 2 HP. Soldado y Capturador causan 1 HP y se sacrifican; resto causa 2 HP.</p></section>
    </div>
    <details><summary>Reglas tácticas esenciales</summary>
      <p>Drones vuelan hasta tres casillas y pueden apilarse sobre una unidad terrestre. Portamisiles protege su hexágono y seis vecinos: intercepta Drones y bloquea disparos enemigos. Solo Soldado, Tanque rápido o Capturador neutralizan un Portamisiles.</p>
      <p>Tanques pueden abandonarse y convertirse permanentemente en Soldados, con movimiento opcional inmediato.</p>
    </details>
    <div class="keyboard-card"><strong>Teclado</strong><span>W/A/S/D mueve el foco · Enter selecciona · Esc cancela</span></div>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-dialog-close>Entendido</button></div>`,
  );
}

function showSettingsDialog(): void {
  openDialog(`
    <span class="eyebrow">OPCIONES</span>
    <h2>Audio y accesibilidad</h2>
    <p>Ajusta cada canal por separado. Los cambios se guardan automáticamente.</p>
    <div class="volume-settings" aria-label="Controles de volumen">
      ${volumeControlMarkup('masterVolume', 'Volumen maestro', 'Controla toda la mezcla', preferences.masterVolume)}
      ${volumeControlMarkup('musicVolume', 'Música', 'Tema ambiental en bucle', preferences.musicVolume)}
      ${volumeControlMarkup('effectsVolume', 'Efectos especiales', 'Movimientos, ataques y avisos', preferences.effectsVolume)}
    </div>
    <div class="accessibility-settings">
      <div><span class="eyebrow">ACCESIBILIDAD</span><p>Adapta la presentación visual a tus necesidades.</p></div>
      <label class="toggle-row"><span><strong>Alto contraste</strong><small>Refuerza bordes y colores del tablero</small></span><input type="checkbox" data-pref="contrast" ${preferences.highContrast ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Reducir movimiento</strong><small>Limita animaciones y transiciones</small></span><input type="checkbox" data-pref="motion" ${preferences.reducedMotion ? 'checked' : ''}/></label>
    </div>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-dialog-close>Listo</button></div>`,
  );

  dialog.querySelectorAll<HTMLInputElement>('[data-volume]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.volume as 'masterVolume' | 'musicVolume' | 'effectsVolume';
      preferences[key] = Number(input.value) / 100;
      input.closest('.volume-control')?.querySelector<HTMLOutputElement>('output')?.replaceChildren(`${input.value}%`);
      audio.setVolumes(preferences.masterVolume, preferences.musicVolume, preferences.effectsVolume);
      audio.startMusic();
      savePreferences();
    });
  });
  dialog.querySelector<HTMLInputElement>('[data-pref="contrast"]')?.addEventListener('change', (event) => {
    preferences.highContrast = (event.currentTarget as HTMLInputElement).checked;
    savePreferences();
    applyPreferences();
    render();
  });
  dialog.querySelector<HTMLInputElement>('[data-pref="motion"]')?.addEventListener('change', (event) => {
    preferences.reducedMotion = (event.currentTarget as HTMLInputElement).checked;
    savePreferences();
    applyPreferences();
    render();
  });
}

function volumeControlMarkup(
  key: 'masterVolume' | 'musicVolume' | 'effectsVolume',
  label: string,
  description: string,
  value: number,
): string {
  const percentage = Math.round(value * 100);
  return `<label class="volume-control">
    <span><strong>${label}</strong><small>${description}</small></span>
    <input type="range" min="0" max="100" step="1" value="${percentage}" data-volume="${key}" aria-label="${label}"/>
    <output>${percentage}%</output>
  </label>`;
}

function showBlockadeDialog(): void {
  if (state.outcome || animating) return;
  const resultPreview = blockadePreview();
  openDialog(`
    <div class="dialog-icon">≋</div>
    <span class="eyebrow">ACUERDO DE BLOQUEO</span>
    <h2>${PLAYER_NAMES[state.activePlayer]} propone finalizar</h2>
    <p>El rival debe aceptar. Según integridad actual, el resultado será: <strong>${resultPreview}</strong>.</p>
    <p class="dialog-warning">Aceptar no consume turno y finaliza inmediatamente la partida.</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-dialog-close>Rechazar</button>
      <button type="button" class="confirm-button" data-accept-blockade>Aceptar como ${PLAYER_NAMES[state.activePlayer === 0 ? 1 : 0]}</button>
    </div>`);
  dialog.querySelector('[data-accept-blockade]')?.addEventListener('click', () => {
    dialog.close();
    void acceptBlockade();
  });
}

async function acceptBlockade(): Promise<void> {
  const before = state;
  const result = declareBlockade(state);
  if (!result.ok) return;
  state = result.state;
  lastEvents = result.events;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  animating = true;
  audio.playEvents(result.events, before);
  render();
  try {
    await renderer.playEvents(result.events, before, preferences.reducedMotion);
  } finally {
    animating = false;
    render();
  }
  showOutcomeDialog();
}

function blockadePreview(): string {
  const fortresses = state.pieces.filter((piece) => piece.type === 'fortress');
  if (fortresses.every((piece) => piece.type === 'fortress' && piece.hp === 2)) return 'tablas';
  return state.firstFortressDamageBy === null
    ? 'tablas'
    : `victoria de ${PLAYER_NAMES[state.firstFortressDamageBy]}`;
}

function showOutcomeDialog(): void {
  if (!state.outcome) return;
  const winnerClass = state.outcome.type === 'win' ? (state.outcome.winner === 0 ? 'blue' : 'amber') : 'draw';
  const remainingBlue = state.pieces.filter((piece) => piece.owner === 0).length;
  const remainingAmber = state.pieces.filter((piece) => piece.owner === 1).length;
  openDialog(`
    <div class="outcome-seal ${winnerClass}"><i></i></div>
    <span class="eyebrow">BATALLA CONCLUIDA</span>
    <h2>${escapeHtml(outcomeText(state.outcome))}</h2>
    <div class="result-stats">
      <span><strong>${Math.ceil(state.ply / 2)}</strong> turnos</span>
      <span><strong>${remainingBlue}</strong> unidades Cian</span>
      <span><strong>${remainingAmber}</strong> unidades Ámbar</span>
    </div>
    <div class="dialog-actions triple">
      <button type="button" class="text-button" data-dialog-close>Revisar tablero</button>
      <button type="button" class="secondary-button" data-new-game>Revancha</button>
      <button type="button" class="confirm-button" data-new-game>Nueva partida</button>
    </div>`);
  dialog.querySelectorAll('[data-new-game]').forEach((button) => {
    button.addEventListener('click', () => {
      dialog.close();
      resetGame();
    });
  });
}

function openDialog(markup: string): void {
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-body">${markup}</div>`;
  const heading = dialog.querySelector<HTMLElement>('h2');
  if (heading) {
    heading.id = 'active-dialog-title';
    heading.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', heading.id);
  } else {
    dialog.removeAttribute('aria-labelledby');
  }
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  dialog.showModal();
  window.setTimeout(() => {
    heading?.focus();
  }, 0);
}

function resetGame(): void {
  state = createInitialState();
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  focusedHex = { q: 0, r: 0 };
  renderer.resetView();
  renderer.snapToPlayer(0);
  render();
  announce('Nueva partida. Turno de Cian.');
  showToast('Despliegue restaurado. Cian inicia.');
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.classList.add('visible'), 10);
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function applyPreferences(): void {
  document.documentElement.classList.toggle('high-contrast', preferences.highContrast);
  document.documentElement.classList.toggle('reduced-motion', preferences.reducedMotion);
}

function loadPreferences(): GamePreferences {
  const fallback: GamePreferences = {
    sound: true,
    masterVolume: 0.8,
    musicVolume: 0.55,
    effectsVolume: 0.8,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    highContrast: false,
  };
  try {
    const stored = localStorage.getItem('atlas-preferences-v1');
    const loaded = stored ? { ...fallback, ...(JSON.parse(stored) as Partial<GamePreferences>) } : fallback;
    loaded.masterVolume = clampPreference(loaded.masterVolume, fallback.masterVolume);
    loaded.musicVolume = clampPreference(loaded.musicVolume, fallback.musicVolume);
    loaded.effectsVolume = clampPreference(loaded.effectsVolume, fallback.effectsVolume);
    return loaded;
  } catch {
    return fallback;
  }
}

function clampPreference(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function savePreferences(): void {
  try {
    localStorage.setItem('atlas-preferences-v1', JSON.stringify(preferences));
  } catch {
    // Preferences remain active for current session when storage is unavailable.
  }
}

function accessibleCellId(hex: Hex): string {
  return `hex-cell-${hex.q + 5}-${hex.r + 5}`;
}

function uniqueDestinations(actions: GameAction[]): string[] {
  const keys = new Set<string>();
  for (const action of actions) {
    if (action.kind === 'move') keys.add(hexKey(action.to));
  }
  return [...keys];
}

function pieceMonogram(piece: Piece): string {
  return {
    soldier: 'S',
    capturer: 'C',
    medium: 'M2',
    long: 'L3',
    fast: 'R',
    drone: 'D',
    antiAir: 'AA',
    fortress: 'F',
  }[piece.type];
}

function pieceDescription(piece: Piece): string {
  return {
    soldier: 'Avanza una casilla en su arco frontal. Puede girar como acción exclusiva.',
    capturer: 'Convierte una unidad rival adyacente sin desplazarse. Capturadores aliados protegen.',
    medium: 'Mueve una casilla o dispara a distancia 2 en el arco del cañón.',
    long: 'Mueve una casilla o dispara exactamente a distancia 3 en cualquier dirección.',
    fast: 'Recorre una línea libre sin límite y captura ocupando el destino.',
    drone: 'Vuela hasta tres casillas, sobrevuela suelo y puede compartir hexágono.',
    antiAir: 'Protege siete hexágonos, intercepta Drones y bloquea fuego a distancia.',
    fortress: 'Objetivo estratégico inmóvil. Su destrucción termina la partida.',
  }[piece.type];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}
