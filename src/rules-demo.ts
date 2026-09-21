import {
  applyAction,
  createGameState,
  getFiringRangeCells,
  getLegalActionsForPiece,
} from './engine';
import { equalHex } from './hex';
import { RULE_SEQUENCES } from './rules-sequences';
import { BoardRenderer, type RenderModel } from './renderer';
import type {
  Direction,
  FortressHp,
  GameAction,
  GameEvent,
  GameState,
  Hex,
  Piece,
  Player,
} from './types';

export const RULE_DEMO_IDS = [
  'fortaleza',
  'soldado',
  'capturador',
  'tanque',
  'lanzamisiles',
  'embestidor',
  'dron',
  'avion',
  'casillas-compartidas',
] as const;

export type RuleDemoId = (typeof RULE_DEMO_IDS)[number];

export interface RuleDemoOptions {
  reducedMotion: boolean;
  highContrast: boolean;
  onSceneChange?: (label: string, index: number, total: number) => void;
  onPlaybackChange?: (paused: boolean, reducedMotion: boolean) => void;
}

export interface RuleDemoController {
  togglePlayback(): void;
  advanceStep(): void;
  restart(): void;
  destroy(): void;
}

export interface RuleDemoScene {
  label: string;
  actorId: string;
  state: GameState;
  action: GameAction;
  sequence: number;
}

const MARKER_PAUSE_MS = 1_700;
const DESTINATION_PAUSE_MS = 900;
const RESULT_PAUSE_MS = 1_400;

const hex = (q: number, r: number): Hex => ({ q, r });

function fortress(id: string, owner: Player, position: Hex, hp: FortressHp = 2): Piece {
  return { id, type: 'fortress', owner, position, hp };
}

function soldier(id: string, owner: Player, position: Hex, facing: Direction): Piece {
  return { id, type: 'soldier', owner, position, facing };
}

function createSceneState(extra: Piece[], activePlayer: Player = 0): GameState {
  const hasBlueFortress = extra.some((piece) => piece.type === 'fortress' && piece.owner === 0);
  const hasAmberFortress = extra.some((piece) => piece.type === 'fortress' && piece.owner === 1);

  return createGameState(
    [
      ...(hasBlueFortress ? [] : [fortress('demo-fort-blue', 0, hex(-5, 0))]),
      ...(hasAmberFortress ? [] : [fortress('demo-fort-amber', 1, hex(5, 0))]),
      soldier('demo-reserve-blue', 0, hex(-5, 1), 2),
      soldier('demo-reserve-amber', 1, hex(5, -1), 5),
      ...extra,
    ],
    activePlayer,
  );
}

export const RULE_DEMO_SCENE_LABELS: Readonly<Record<RuleDemoId, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      RULE_DEMO_IDS.map((demoId) => [
        demoId,
        Object.freeze(
          RULE_SEQUENCES[demoId].flatMap((sequence) => sequence.steps.map((step) => step.label)),
        ),
      ]),
    ) as Record<RuleDemoId, readonly string[]>,
  );

/** Creates fresh deterministic states and resolves each planned action through the real engine. */
export function createRuleDemoScenes(demoId: RuleDemoId): RuleDemoScene[] {
  return RULE_SEQUENCES[demoId].flatMap((sequence, sequenceIndex) => {
    let state = createSceneState(sequence.pieces);
    return sequence.steps.map((step) => {
      const actor = state.pieces.find((piece) => piece.id === step.actorId)!;
      state = { ...state, activePlayer: actor.owner, outcome: null };
      const action = getLegalActionsForPiece(state, step.actorId).find(
        (candidate) =>
          candidate.kind === step.kind &&
          (!step.to || ('to' in candidate && candidate.to && equalHex(candidate.to, step.to))) &&
          (!step.targetId || ('targetId' in candidate && candidate.targetId === step.targetId)) &&
          (step.cannon === undefined ||
            ('cannon' in candidate && candidate.cannon === step.cannon)) &&
          (step.kamikaze === undefined ||
            ('kamikaze' in candidate && candidate.kamikaze === step.kamikaze)),
      );
      if (!action) throw new Error('No existe una acción legal para: ' + step.label);
      const scene = {
        label: step.label,
        actorId: step.actorId,
        state,
        action,
        sequence: sequenceIndex,
      };
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error);
      state = result.state;
      return scene;
    });
  });
}

function fortressMaximums(state: GameState): [FortressHp, FortressHp] {
  const maximums = ([0, 1] as const).map((owner) => {
    const piece = state.pieces.find(
      (candidate) => candidate.type === 'fortress' && candidate.owner === owner,
    );
    return piece?.type === 'fortress' ? piece.hp : 1;
  });
  return [maximums[0], maximums[1]];
}

function sceneModel(
  scene: RuleDemoScene,
  state: GameState,
  options: RuleDemoOptions,
  presentation: {
    selectedId: string | null;
    actions: GameAction[];
    pending: GameAction | null;
    lastEvents: GameEvent[];
  },
): RenderModel {
  return {
    state: { ...state, pieces: state.pieces.filter((piece) => !piece.id.startsWith('demo-')) },
    fortressMaxHp: fortressMaximums(scene.state),
    selectedId: presentation.selectedId,
    actions: presentation.actions,
    pending: presentation.pending,
    hovered: null,
    focused: null,
    firingRange: presentation.selectedId ? getFiringRangeCells(state, presentation.selectedId) : [],
    lastEvents: presentation.lastEvents,
    threatenedCells: [],
    reducedMotion: options.reducedMotion,
    highContrast: options.highContrast,
  };
}

function restoreAttribute(canvas: HTMLCanvasElement, name: string, value: string | null): void {
  if (value === null) canvas.removeAttribute(name);
  else canvas.setAttribute(name, value);
}

export function mountRuleDemo(
  canvas: HTMLCanvasElement,
  demoId: RuleDemoId,
  options: RuleDemoOptions,
): RuleDemoController {
  options = {
    ...options,
    reducedMotion:
      options.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const scenes = createRuleDemoScenes(demoId);
  const renderer = new BoardRenderer(canvas);
  const originalAttributes = new Map(
    ['role', 'aria-label', 'data-rule-demo-id', 'data-rule-demo-scene'].map((name) => [
      name,
      canvas.getAttribute(name),
    ]),
  );
  let sceneIndex = 0;
  let timer: number | null = null;
  let cycleToken = 0;
  let destroyed = false;
  let paused = options.reducedMotion;
  let visible = true;
  let showingResult = false;
  const canPlay = (): boolean => !paused && visible && document.visibilityState !== 'hidden';
  const updateControls = (): void => {
    options.onPlaybackChange?.(paused, options.reducedMotion);
  };

  const clearTimer = (): void => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const schedule = (callback: () => void, delay: number): void => {
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      callback();
    }, delay);
  };

  const updateSceneMetadata = (scene: RuleDemoScene): void => {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', scene.label);
    canvas.dataset.ruleDemoId = demoId;
    canvas.dataset.ruleDemoScene = `${sceneIndex + 1}/${scenes.length}`;
    options.onSceneChange?.(scene.label, sceneIndex, scenes.length);
  };

  const showScene = (): void => {
    if (destroyed) return;
    const scene = scenes[sceneIndex];
    const token = ++cycleToken;
    const actions = getLegalActionsForPiece(scene.state, scene.actorId);
    showingResult = false;
    updateSceneMetadata(scene);
    renderer.setModel(
      sceneModel(
        scene,
        scene.state,
        { ...options, reducedMotion: !canPlay() },
        {
          selectedId: scene.actorId,
          actions,
          pending: null,
          lastEvents: [],
        },
      ),
    );

    if (!canPlay()) return;
    schedule(() => {
      renderer.setModel(
        sceneModel(scene, scene.state, options, {
          selectedId: scene.actorId,
          actions,
          pending: scene.action,
          lastEvents: [],
        }),
      );
      schedule(() => {
        if (destroyed || token !== cycleToken || !canPlay()) return;
        const result = applyAction(scene.state, scene.action);
        if (!result.ok) return;

        renderer.setModel(
          sceneModel(scene, result.state, options, {
            selectedId: null,
            actions: [],
            pending: null,
            lastEvents: result.events,
          }),
        );
        void renderer.playEvents(result.events, scene.state, false, 2).then(() => {
          if (destroyed || token !== cycleToken || !canPlay()) return;
          showingResult = true;
          schedule(
            () => {
              if (destroyed || token !== cycleToken) return;
              sceneIndex = (sceneIndex + 1) % scenes.length;
              showScene();
            },
            scenes[(sceneIndex + 1) % scenes.length].sequence !== scene.sequence ||
              sceneIndex === scenes.length - 1
              ? 2_600
              : RESULT_PAUSE_MS,
          );
        });
      }, DESTINATION_PAUSE_MS);
    }, MARKER_PAUSE_MS);
  };

  const handleVisibilityChange = (): void => {
    if (destroyed) return;
    clearTimer();
    cycleToken += 1;
    void renderer.playEvents([], scenes[sceneIndex].state, true);
    if (showingResult) {
      if (canPlay()) {
        schedule(() => {
          sceneIndex = (sceneIndex + 1) % scenes.length;
          showScene();
        }, RESULT_PAUSE_MS);
      }
    } else {
      showScene();
    }
  };

  const togglePlayback = (): void => {
    if (destroyed || options.reducedMotion) return;
    paused = !paused;
    updateControls();
    handleVisibilityChange();
  };
  const advanceStep = (): void => {
    if (destroyed) return;
    paused = true;
    updateControls();
    clearTimer();
    cycleToken += 1;
    const scene = scenes[sceneIndex];
    void renderer.playEvents([], scene.state, true);
    if (showingResult) {
      sceneIndex = (sceneIndex + 1) % scenes.length;
      showScene();
    } else {
      const result = applyAction(scene.state, scene.action);
      if (!result.ok) return;
      renderer.setModel(
        sceneModel(
          scene,
          result.state,
          { ...options, reducedMotion: true },
          {
            selectedId: null,
            actions: [],
            pending: null,
            lastEvents: result.events,
          },
        ),
      );
      showingResult = true;
    }
  };
  const restartDemo = (): void => {
    if (destroyed) return;
    sceneIndex = 0;
    showingResult = false;
    handleVisibilityChange();
  };
  const observer = new IntersectionObserver(([entry]) => {
    if (visible === entry.isIntersecting) return;
    visible = entry.isIntersecting;
    handleVisibilityChange();
  });

  renderer.setDepthMode(false, true);
  renderer.snapToPlayer(0);
  renderer.setFrame(
    scenes.flatMap((scene) =>
      scene.state.pieces
        .filter((piece) => !piece.id.startsWith('demo-'))
        .map((piece) => piece.position),
    ),
  );
  document.addEventListener('visibilitychange', handleVisibilityChange);
  observer.observe(canvas);
  updateControls();
  showScene();

  return {
    togglePlayback,
    advanceStep,
    restart: restartDemo,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cycleToken += 1;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
      renderer.destroy();
      for (const [name, value] of originalAttributes) restoreAttribute(canvas, name, value);
    },
  };
}
