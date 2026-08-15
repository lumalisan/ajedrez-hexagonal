import {
  applyAction,
  createGameState,
  getFiringRangeCells,
  getLegalActionsForPiece,
} from './engine';
import { equalHex } from './hex';
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
}

export interface RuleDemoScene {
  label: string;
  actorId: string;
  state: GameState;
  action: GameAction;
}

interface RuleDemoSceneDefinition {
  label: string;
  actorId: string;
  createState: () => GameState;
  selectAction: (actions: readonly GameAction[]) => GameAction | undefined;
}

type MoveAction = Extract<GameAction, { kind: 'move' }>;

const MARKER_PAUSE_MS = 920;
const RESULT_PAUSE_MS = 1_120;

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
      soldier('demo-reserve-blue', 0, hex(-4, 1), 2),
      soldier('demo-reserve-amber', 1, hex(4, -1), 5),
      ...extra,
    ],
    activePlayer,
  );
}

function selectKind<K extends GameAction['kind']>(
  kind: K,
  predicate: (action: Extract<GameAction, { kind: K }>) => boolean = () => true,
): (actions: readonly GameAction[]) => GameAction | undefined {
  return (actions) =>
    actions.find(
      (action) => action.kind === kind && predicate(action as Extract<GameAction, { kind: K }>),
    );
}

function moveTo(
  to: Hex,
  predicate: (action: MoveAction) => boolean = () => true,
): (actions: readonly GameAction[]) => GameAction | undefined {
  return selectKind('move', (action) => equalHex(action.to, to) && predicate(action));
}

const RULE_DEMO_DEFINITIONS: Record<RuleDemoId, readonly RuleDemoSceneDefinition[]> = {
  fortaleza: [
    {
      label: 'Un impacto resta 1 PV a la Fortaleza y el Soldado se sacrifica.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          fortress('fort-amber', 1, hex(0, -1), 3),
          soldier('actor', 0, hex(0, 0), 0),
        ]),
      selectAction: moveTo(hex(0, -1)),
    },
    {
      label: 'El escudo antiaéreo intercepta una aeronave al entrar en su zona.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'drone', owner: 0, position: hex(0, 0) },
          { id: 'anti-air', type: 'antiAir', owner: 1, position: hex(2, 0) },
        ]),
      selectAction: moveTo(hex(1, 0)),
    },
  ],
  soldado: [
    {
      label: 'El Soldado avanza por una de sus tres casillas frontales y se orienta al moverse.',
      actorId: 'actor',
      createState: () => createSceneState([soldier('actor', 0, hex(0, 0), 0)]),
      selectAction: moveTo(hex(1, -1)),
    },
    {
      label: 'El Soldado elimina una unidad enemiga situada dentro de su avance frontal.',
      actorId: 'actor',
      createState: () =>
        createSceneState([soldier('actor', 0, hex(0, 0), 0), soldier('target', 1, hex(0, -1), 3)]),
      selectAction: moveTo(hex(0, -1)),
    },
    {
      label: 'El Soldado puede emplear su turno en cambiar de orientación sin desplazarse.',
      actorId: 'actor',
      createState: () => createSceneState([soldier('actor', 0, hex(0, 0), 0)]),
      selectAction: selectKind('rotate', (action) => action.facing === 3),
    },
  ],
  capturador: [
    {
      label: 'El Capturador puede desplazarse a cualquiera de sus seis casillas adyacentes.',
      actorId: 'actor',
      createState: () =>
        createSceneState([{ id: 'actor', type: 'capturer', owner: 0, position: hex(0, 0) }]),
      selectAction: moveTo(hex(1, 0)),
    },
    {
      label: 'La unidad capturada cambia de bando y ambas piezas conservan su casilla.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'capturer', owner: 0, position: hex(0, 0) },
          soldier('target', 1, hex(1, 0), 3),
        ]),
      selectAction: selectKind('convert', (action) => action.targetId === 'target'),
    },
    {
      label: 'La Fortaleza no se captura: el Capturador la ataca y se sacrifica.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          fortress('fort-amber', 1, hex(0, -1), 3),
          { id: 'actor', type: 'capturer', owner: 0, position: hex(0, 0) },
        ]),
      selectAction: moveTo(hex(0, -1), (action) => action.targetId === 'fort-amber'),
    },
  ],
  tanque: [
    {
      label: 'El Tanque se desplaza y orienta su cañón en la misma acción.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'medium', owner: 0, position: hex(0, 0), cannon: 3 },
        ]),
      selectAction: moveTo(hex(1, 0), (action) => action.cannon === 0),
    },
    {
      label: 'El Tanque dispara contra una de las tres casillas situadas dos pasos al frente.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
          soldier('target', 1, hex(0, -2), 3),
        ]),
      selectAction: selectKind('shoot', (action) => action.targetId === 'target'),
    },
    {
      label: 'El Tanque se abandona y el Soldado resultante avanza en ese mismo turno.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'medium', owner: 0, position: hex(0, 0), cannon: 3 },
        ]),
      selectAction: selectKind(
        'transform',
        (action) => action.facing === 0 && Boolean(action.to && equalHex(action.to, hex(0, -1))),
      ),
    },
  ],
  lanzamisiles: [
    {
      label: 'El Lanzamisiles puede desplazarse a una de las seis casillas adyacentes.',
      actorId: 'actor',
      createState: () =>
        createSceneState([{ id: 'actor', type: 'long', owner: 0, position: hex(0, 0) }]),
      selectAction: moveTo(hex(1, 0)),
    },
    {
      label: 'El Lanzamisiles alcanza objetivos situados exactamente a tres casillas.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'long', owner: 0, position: hex(0, 0) },
          soldier('target', 1, hex(0, -3), 3),
        ]),
      selectAction: selectKind('shoot', (action) => action.targetId === 'target'),
    },
    {
      label: 'Al abandonarlo, el Soldado resultante puede atacar al Dron situado encima.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'long', owner: 0, position: hex(0, 0) },
          { id: 'air-target', type: 'drone', owner: 1, position: hex(0, 0) },
        ]),
      selectAction: selectKind(
        'transform',
        (action) => action.facing === 0 && action.attackAboveId === 'air-target',
      ),
    },
  ],
  embestidor: [
    {
      label: 'El Embestidor recorre una línea despejada sin límite de distancia.',
      actorId: 'actor',
      createState: () =>
        createSceneState([{ id: 'actor', type: 'fast', owner: 0, position: hex(0, 0) }]),
      selectAction: moveTo(hex(3, 0)),
    },
    {
      label: 'El Embestidor elimina al primer enemigo de su trayectoria y ocupa su casilla.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'fast', owner: 0, position: hex(0, 0) },
          soldier('target', 1, hex(3, 0), 3),
        ]),
      selectAction: moveTo(hex(3, 0)),
    },
    {
      label: 'Si un Dron enemigo está encima, el Embestidor puede atacarlo directamente.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'fast', owner: 0, position: hex(0, 0) },
          { id: 'air-target', type: 'drone', owner: 1, position: hex(0, 0) },
        ]),
      selectAction: selectKind('attackAbove', (action) => action.targetId === 'air-target'),
    },
  ],
  dron: [
    {
      label: 'El Dron sobrevuela unidades terrestres y puede terminar sobre una unidad aliada.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'drone', owner: 0, position: hex(0, 0) },
          soldier('ground-one', 0, hex(1, 0), 0),
          { id: 'ground-two', type: 'medium', owner: 0, position: hex(3, 0), cannon: 0 },
        ]),
      selectAction: moveTo(hex(3, 0)),
    },
    {
      label: 'El Dron ataca al finalizar su vuelo y ocupa la casilla de la unidad eliminada.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'drone', owner: 0, position: hex(0, 0) },
          soldier('target', 1, hex(2, 0), 3),
        ]),
      selectAction: moveTo(hex(2, 0)),
    },
  ],
  avion: [
    {
      label: 'El Avión avanza hasta dos casillas y cambia su orientación al volar en diagonal.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
        ]),
      selectAction: moveTo(hex(2, -2)),
    },
    {
      label: 'El Avión dispara dentro de su cono frontal sin desplazarse.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
          soldier('target', 1, hex(0, -3), 3),
        ]),
      selectAction: selectKind('shoot', (action) => action.targetId === 'target'),
    },
    {
      label: 'En un ataque kamikaze, el Avión y su objetivo quedan destruidos.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
          soldier('target', 1, hex(0, -2), 3),
        ]),
      selectAction: moveTo(hex(0, -2), (action) => Boolean(action.kamikaze)),
    },
  ],
  'casillas-compartidas': [
    {
      label: 'El Soldado ataca la unidad terrestre inferior; la aeronave enemiga permanece.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          soldier('actor', 0, hex(0, 0), 0),
          soldier('ground-target', 1, hex(0, -1), 3),
          { id: 'air-target', type: 'drone', owner: 1, position: hex(0, -1) },
        ]),
      selectAction: moveTo(hex(0, -1)),
    },
    {
      label: 'El Tanque elige una sola capa de la casilla compartida como objetivo.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
          soldier('ground-target', 1, hex(0, -2), 3),
          { id: 'air-target', type: 'drone', owner: 1, position: hex(0, -2) },
        ]),
      selectAction: selectKind('shoot', (action) => action.targetId === 'air-target'),
    },
    {
      label: 'El Dron elimina solo la aeronave superior y queda sobre la unidad terrestre enemiga.',
      actorId: 'actor',
      createState: () =>
        createSceneState([
          { id: 'actor', type: 'drone', owner: 0, position: hex(0, 0) },
          soldier('ground-target', 1, hex(2, 0), 3),
          { id: 'air-target', type: 'airplane', owner: 1, position: hex(2, 0), facing: 3 },
        ]),
      selectAction: moveTo(hex(2, 0)),
    },
  ],
};

export const RULE_DEMO_SCENE_LABELS: Readonly<Record<RuleDemoId, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      RULE_DEMO_IDS.map((demoId) => [
        demoId,
        Object.freeze(RULE_DEMO_DEFINITIONS[demoId].map((scene) => scene.label)),
      ]),
    ) as Record<RuleDemoId, readonly string[]>,
  );

/** Creates fresh deterministic states and resolves each planned action through the real engine. */
export function createRuleDemoScenes(demoId: RuleDemoId): RuleDemoScene[] {
  return RULE_DEMO_DEFINITIONS[demoId].map((definition) => {
    const state = definition.createState();
    const action = definition.selectAction(getLegalActionsForPiece(state, definition.actorId));
    if (!action) {
      throw new Error(
        `La escena «${definition.label}» no pudo resolver una acción legal para ${definition.actorId}.`,
      );
    }
    return {
      label: definition.label,
      actorId: definition.actorId,
      state,
      action,
    };
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
    state,
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
): { destroy(): void } {
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
    updateSceneMetadata(scene);
    renderer.setModel(
      sceneModel(scene, scene.state, options, {
        selectedId: scene.actorId,
        actions,
        pending: scene.action,
        lastEvents: [],
      }),
    );

    if (options.reducedMotion || document.visibilityState === 'hidden') return;
    schedule(() => {
      if (destroyed || token !== cycleToken || document.visibilityState === 'hidden') return;
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
      void renderer.playEvents(result.events, scene.state, false).then(() => {
        if (destroyed || token !== cycleToken || document.visibilityState === 'hidden') return;
        schedule(() => {
          if (destroyed || token !== cycleToken) return;
          sceneIndex = (sceneIndex + 1) % scenes.length;
          showScene();
        }, RESULT_PAUSE_MS);
      });
    }, MARKER_PAUSE_MS);
  };

  const handleVisibilityChange = (): void => {
    if (options.reducedMotion || destroyed) return;
    clearTimer();
    cycleToken += 1;
    if (document.visibilityState === 'hidden') {
      void renderer.playEvents([], scenes[sceneIndex].state, true);
      return;
    }
    showScene();
  };

  renderer.setDepthMode(true, options.reducedMotion);
  renderer.snapToPlayer(0);
  renderer.zoomBy(1.4);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  showScene();

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      cycleToken += 1;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      renderer.destroy();
      for (const [name, value] of originalAttributes) restoreAttribute(canvas, name, value);
    },
  };
}
