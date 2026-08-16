import { createGameState, getPiece } from './engine';
import type {
  Direction,
  FortressHp,
  GameAction,
  GameState,
  Hex,
  Piece,
  Player,
  ScenarioDefinition,
  ScenarioObjective,
} from './types';

export type ScenarioProgressStatus = 'in-progress' | 'success' | 'failure';

export interface ScenarioProgress {
  status: ScenarioProgressStatus;
  elapsedPlies: number;
  remainingPlies: number | null;
  feedback: string;
  reason?: 'objective' | 'limit' | 'protected-piece-lost' | 'defeat' | 'draw';
}

export interface ProgressiveHint {
  hint: string | null;
  revealedCount: number;
  total: number;
  exhausted: boolean;
}

interface ScenarioOptions {
  maxPlies?: number;
  category: NonNullable<ScenarioDefinition['category']>;
  difficulty: NonNullable<ScenarioDefinition['difficulty']>;
  lesson: string;
  stages?: NonNullable<ScenarioDefinition['stages']>;
  fortressHp?: [FortressHp, FortressHp];
  fortressPositions?: [Hex, Hex];
}

const fortress = (id: string, owner: Player, position: Hex, hp: FortressHp = 2): Piece => ({
  id,
  type: 'fortress',
  owner,
  position,
  hp,
});

const soldier = (id: string, owner: Player, q: number, r: number, facing: Direction): Piece => ({
  id,
  type: 'soldier',
  owner,
  position: { q, r },
  facing,
});

function scenario(
  id: string,
  title: string,
  summary: string,
  pieces: Piece[],
  objective: ScenarioObjective,
  hints: string[],
  successText: string,
  options: ScenarioOptions,
): ScenarioDefinition {
  const fortressPositions = options.fortressPositions ?? [
    { q: -5, r: 0 },
    { q: 5, r: 0 },
  ];
  const fortressHp = options.fortressHp ?? [2, 2];
  return {
    id,
    title,
    summary,
    controlledPlayer: 0,
    initialState: createGameState([
      fortress('academy-blue-fortress', 0, fortressPositions[0], fortressHp[0]),
      fortress('academy-amber-fortress', 1, fortressPositions[1], fortressHp[1]),
      ...pieces,
    ]),
    objective,
    maxPlies: options.maxPlies ?? 4,
    hints,
    successText,
    category: options.category,
    difficulty: options.difficulty,
    lesson: options.lesson,
    stages: options.stages,
  };
}

export const BASIC_SCENARIOS: ScenarioDefinition[] = [
  scenario(
    'movement',
    '1 · Movimiento y orientación',
    'Mueve el Soldado hacia su arco frontal.',
    [soldier('academy-soldier', 0, 0, 0, 0)],
    { kind: 'perform-action', actionKind: 'move', pieceId: 'academy-soldier' },
    [
      'Selecciona el Soldado situado en el centro.',
      'Las tres marcas verdes señalan las casillas de su arco frontal.',
      'Elige una marca y confirma la orden. Al moverse, el Soldado queda orientado hacia el destino.',
    ],
    'Has movido y reorientado el Soldado: cada avance también prepara su siguiente arco.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: piensa una orden por delante; la orientación de hoy decide las rutas de mañana.',
    },
  ),
  scenario(
    'capture',
    '2 · Conversión sin movimiento',
    'Convierte la unidad adyacente con el Capturador.',
    [
      { id: 'academy-capturer', type: 'capturer', owner: 0, position: { q: 0, r: 0 } },
      soldier('capture-target', 1, 0, -1, 3),
    ],
    { kind: 'perform-action', actionKind: 'convert', pieceId: 'academy-capturer' },
    [
      'Selecciona el Capturador del centro.',
      'La red sobre la unidad rival señala una conversión, no un movimiento.',
      'Elige al Soldado rival y confirma: cambiará de bando sin que el Capturador se desplace.',
    ],
    'Conversión completada: has cambiado material y control sin ceder la casilla del Capturador.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: una conversión vale más que una captura porque resta una unidad y suma otra.',
    },
  ),
  scenario(
    'medium',
    '3 · Tanque',
    'Orienta el cañón o alcanza el objetivo frontal.',
    [
      { id: 'academy-medium', type: 'medium', owner: 0, position: { q: 0, r: 1 }, cannon: 0 },
      soldier('medium-target', 1, 0, -1, 3),
    ],
    { kind: 'capture', targetId: 'medium-target' },
    [
      'Selecciona el Tanque.',
      'Su cañón cubre tres casillas a distancia dos; el alcance no empieza en la casilla adyacente.',
      'Elige el objetivo rosa y confirma. Disparar no desplaza el Tanque.',
    ],
    'Objetivo neutralizado: el Tanque domina un frente estrecho y premia la orientación previa.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: orienta antes de que aparezca la amenaza para no perder un turno de fuego.',
    },
  ),
  scenario(
    'long',
    '4 · Distancia exacta',
    'El Lanzamisiles dispara exactamente a distancia tres.',
    [
      { id: 'academy-long', type: 'long', owner: 0, position: { q: 0, r: 2 } },
      soldier('long-target', 1, 0, -1, 3),
    ],
    { kind: 'capture', targetId: 'long-target' },
    [
      'Selecciona el Lanzamisiles.',
      'Solo puede disparar a exactamente tres hexágonos, aunque haya casillas vacías entre medias.',
      'Elige el marcador rosa sobre el Soldado rival y confirma.',
    ],
    'Has dominado el alcance exacto: la distancia correcta convierte espacio vacío en presión.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: conserva la distancia tres; acercarte demasiado también puede dejarte sin tiro.',
    },
  ),
  scenario(
    'drone',
    '5 · Vuelo y apilamiento',
    'Apila el Dron sobre la unidad aliada.',
    [
      { id: 'academy-drone', type: 'drone', owner: 0, position: { q: 0, r: 2 } },
      soldier('stack-ally', 0, 0, 0, 0),
    ],
    { kind: 'perform-action', actionKind: 'move', pieceId: 'academy-drone' },
    [
      'Selecciona el Dron situado al sur.',
      'Los Drones vuelan hasta tres casillas y pueden pasar sobre unidades terrestres.',
      'Muévelo a la casilla de tu Soldado: ambos quedarán apilados en capas distintas.',
    ],
    'Apilamiento completado: dos capas comparten espacio, pero conservan amenazas distintas.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: apilar concentra fuerza, pero también convierte una casilla en objetivo prioritario.',
    },
  ),
  scenario(
    'anti-air',
    '6 · Intercepción',
    'Observa cómo una zona rival intercepta tu Dron.',
    [
      { id: 'academy-aa', type: 'antiAir', owner: 1, position: { q: 0, r: 0 } },
      { id: 'academy-enemy-drone', type: 'drone', owner: 0, position: { q: 0, r: -2 } },
    ],
    { kind: 'capture', targetId: 'academy-enemy-drone' },
    [
      'Selecciona tu Dron.',
      'El Escudo antiaéreo rival protege su propia casilla y las seis adyacentes.',
      'Mueve el Dron a una marca dentro de esa zona para observar la intercepción automática.',
    ],
    'Intercepción observada: una ruta legal puede seguir siendo un sacrificio deliberado.',
    {
      category: 'basic',
      difficulty: 1,
      lesson: 'Principio: comprueba toda la trayectoria aérea, no solo el destino.',
    },
  ),
  scenario(
    'transform',
    '7 · Abandono de vehículo',
    'Convierte el Embestidor en Soldado.',
    [{ id: 'academy-fast', type: 'fast', owner: 0, position: { q: 0, r: 0 } }],
    { kind: 'perform-action', actionKind: 'transform', pieceId: 'academy-fast' },
    [
      'Selecciona el Embestidor.',
      'Pulsa Transformar: abandonar el Embestidor es permanente.',
      'Elige la orientación del nuevo Soldado y confirma.',
    ],
    'La tripulación continúa como Soldado: has cambiado potencia por acceso y orientación.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: transforma por una ventaja inmediata concreta, no solo porque la opción exista.',
    },
  ),
  scenario(
    'fortress',
    '8 · Asalto final',
    'Inflige el último punto de daño a la Fortaleza.',
    [soldier('academy-assault', 0, 4, 0, 1)],
    { kind: 'damage-fortress', owner: 1 },
    [
      'Selecciona el Soldado situado junto a la Fortaleza rival.',
      'El ataque causará 1 HP de daño y sacrificará al Soldado.',
      'Elige la Fortaleza y confirma para completar el asalto.',
    ],
    'Asalto completado: el intercambio es correcto porque el objetivo estratégico decide la partida.',
    {
      category: 'basic',
      difficulty: 1,
      lesson:
        'Principio: el valor de una unidad depende del objetivo; un sacrificio ganador no es una pérdida.',
      fortressHp: [2, 1],
    },
  ),
];

export const GUIDED_SCENARIOS: ScenarioDefinition[] = [
  scenario(
    'guided-combined-arms',
    '9 · Brecha de armas combinadas',
    'Abre dos líneas de bloqueo y remata la Fortaleza en un máximo de siete órdenes.',
    [
      { id: 'guided-long', type: 'long', owner: 0, position: { q: -1, r: 0 } },
      { id: 'guided-medium', type: 'medium', owner: 0, position: { q: 1, r: 1 }, cannon: 1 },
      { id: 'guided-fast', type: 'fast', owner: 0, position: { q: 0, r: 0 } },
      soldier('guided-blocker-one', 1, 2, 0, 3),
      soldier('guided-blocker-two', 1, 3, 0, 3),
      soldier('guided-amber-reserve', 1, 4, -2, 3),
    ],
    { kind: 'win-in', maxPlies: 7 },
    [
      'Primero usa el Lanzamisiles: el bloqueo más cercano está exactamente a distancia tres.',
      'Después del turno Ámbar, el Tanque puede retirar el segundo bloqueo desde su cono actual.',
      'Cuando la línea 0,0 → 5,0 esté libre, el Embestidor puede cerrar la operación.',
    ],
    'Victoria coordinada: cada unidad abrió la oportunidad que necesitaba la siguiente.',
    {
      category: 'guided',
      difficulty: 2,
      lesson:
        'Principio: una combinación táctica es una cadena de funciones, no una suma de ataques aislados.',
      maxPlies: 7,
      fortressHp: [2, 1],
      stages: [
        {
          atPly: 0,
          text: 'Etapa 1 · Identifica qué pieza puede retirar el primer bloqueo sin moverse.',
        },
        { atPly: 1, text: 'Etapa 2 · Conserva la iniciativa mientras Ámbar responde.' },
        { atPly: 2, text: 'Etapa 3 · El segundo bloqueo cae dentro del cono del Tanque.' },
        {
          atPly: 3,
          text: 'Etapa 4 · Verifica la línea completa antes de comprometer el Embestidor.',
        },
        { atPly: 4, text: 'Etapa 5 · La ruta está abierta: convierte espacio en victoria.' },
      ],
    },
  ),
];

export const STRATEGIC_SCENARIOS: ScenarioDefinition[] = [
  scenario(
    'strategy-tempo',
    'Desafío · Presión sostenida',
    'Destruye la Fortaleza en tres órdenes sin abandonar la línea de tiro.',
    [
      { id: 'tempo-long', type: 'long', owner: 0, position: { q: 2, r: 0 } },
      soldier('tempo-reserve', 1, 4, -2, 3),
    ],
    { kind: 'win-in', maxPlies: 3 },
    [
      'La Fortaleza está exactamente a distancia tres.',
      'Tu primer impacto no basta: conserva al Lanzamisiles en la misma geometría.',
      'No confundas actividad con progreso; repetir una amenaza puede ser la mejor continuación.',
    ],
    'Has mantenido una amenaza que el rival no podía neutralizar a tiempo.',
    {
      category: 'strategic',
      difficulty: 2,
      lesson:
        'Principio: el tempo importa cuando obligas al rival a responder sin romper tu amenaza.',
      maxPlies: 3,
    },
  ),
  scenario(
    'strategy-survive',
    'Desafío · Cambiar la amenaza de bando',
    'Sobrevive cuatro órdenes ante un Lanzamisiles que ya apunta a tu Fortaleza.',
    [
      { id: 'survive-capturer', type: 'capturer', owner: 0, position: { q: 0, r: 2 } },
      soldier('survive-blue-reserve', 0, -1, 0, 0),
      { id: 'survive-long', type: 'long', owner: 1, position: { q: 0, r: 3 } },
      soldier('survive-amber-reserve', 1, 3, 0, 3),
    ],
    { kind: 'survive', plies: 4, owner: 0 },
    [
      'El Lanzamisiles ya tiene tu Fortaleza a distancia exacta.',
      'Destruir no es la única defensa disponible.',
      'El Capturador está adyacente: convierte la amenaza y después conserva la posición.',
    ],
    'Has sobrevivido cambiando la propiedad de la amenaza antes de que pudiera disparar.',
    {
      category: 'strategic',
      difficulty: 2,
      lesson:
        'Principio: la defensa activa elimina la amenaza; la defensa superior la transforma en recurso.',
      maxPlies: 4,
      fortressHp: [1, 2],
      fortressPositions: [
        { q: 0, r: 0 },
        { q: 5, r: 0 },
      ],
    },
  ),
  scenario(
    'strategy-protect',
    'Desafío · Mantener el enlace',
    'Protege la unidad de enlace durante cinco órdenes.',
    [
      soldier('protect-relay', 0, 0, 0, 0),
      { id: 'protect-capturer', type: 'capturer', owner: 0, position: { q: 0, r: 2 } },
      { id: 'protect-long', type: 'long', owner: 1, position: { q: 0, r: 3 } },
      soldier('protect-amber-reserve', 1, 3, 0, 3),
    ],
    { kind: 'protect-piece', pieceId: 'protect-relay', plies: 5 },
    [
      'La unidad de enlace está dentro del alcance exacto del Lanzamisiles.',
      'Mover el enlace puede no sacarlo del anillo de distancia tres.',
      'Neutraliza la capacidad de disparo convirtiendo al atacante.',
    ],
    'El enlace sigue operativo: protegiste la función importante, no solo una casilla.',
    {
      category: 'strategic',
      difficulty: 3,
      lesson: 'Principio: proteger significa reducir las respuestas rivales, no limitarse a huir.',
      maxPlies: 5,
    },
  ),
  scenario(
    'strategy-reach',
    'Desafío · Corredor de extracción',
    'Lleva el explorador al punto de extracción en tres órdenes.',
    [soldier('reach-scout', 0, 0, 0, 0), soldier('reach-amber-reserve', 1, 4, -2, 3)],
    { kind: 'reach', pieceId: 'reach-scout', target: { q: 0, r: -2 } },
    [
      'El punto de extracción está dos hexágonos al norte.',
      'El Soldado solo avanza dentro de su arco frontal.',
      'Cada movimiento conserva o cambia su orientación según el destino; encadena dos avances al norte.',
    ],
    'Extracción completada: planificaste orientación y ruta como una sola decisión.',
    {
      category: 'strategic',
      difficulty: 2,
      lesson: 'Principio: una ruta es viable cuando cada paso prepara legalmente el siguiente.',
      maxPlies: 3,
    },
  ),
];

export const SCENARIOS: ScenarioDefinition[] = [
  ...BASIC_SCENARIOS,
  ...GUIDED_SCENARIOS,
  ...STRATEGIC_SCENARIOS,
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenarioDefinition) => scenarioDefinition.id === id);
}

export function scenariosByCategory(
  category: NonNullable<ScenarioDefinition['category']>,
): ScenarioDefinition[] {
  return SCENARIOS.filter((scenarioDefinition) => scenarioDefinition.category === category);
}

export function evaluateScenario(
  scenarioDefinition: ScenarioDefinition,
  before: GameState,
  after: GameState,
  action: GameAction,
): boolean {
  return evaluateScenarioProgress(scenarioDefinition, before, after, action).status === 'success';
}

export function evaluateScenarioProgress(
  scenarioDefinition: ScenarioDefinition,
  before: GameState,
  after: GameState,
  action: GameAction,
): ScenarioProgress {
  const elapsedPlies = Math.max(0, after.ply - scenarioDefinition.initialState.ply);
  const limit = objectiveLimit(scenarioDefinition);
  const remainingPlies = limit === null ? null : Math.max(0, limit - elapsedPlies);
  const feedback = scenarioLessonAt(scenarioDefinition, elapsedPlies);

  if (objectiveAchieved(scenarioDefinition, before, after, action, elapsedPlies)) {
    return {
      status: 'success',
      elapsedPlies,
      remainingPlies,
      feedback: scenarioDefinition.successText,
      reason: 'objective',
    };
  }

  const objective = scenarioDefinition.objective;
  if (objective.kind === 'protect-piece' || objective.kind === 'reach') {
    const initialPiece = getPiece(scenarioDefinition.initialState, objective.pieceId);
    const currentPiece = getPiece(after, objective.pieceId);
    if (!currentPiece || (initialPiece && currentPiece.owner !== initialPiece.owner)) {
      return {
        status: 'failure',
        elapsedPlies,
        remainingPlies,
        feedback: 'La unidad necesaria ya no puede completar el objetivo.',
        reason: 'protected-piece-lost',
      };
    }
  }

  if (
    after.outcome?.type === 'win' &&
    after.outcome.winner !== scenarioDefinition.controlledPlayer
  ) {
    return {
      status: 'failure',
      elapsedPlies,
      remainingPlies,
      feedback: 'El rival ha cumplido su condición de victoria.',
      reason: 'defeat',
    };
  }
  if (after.outcome?.type === 'draw') {
    return {
      status: 'failure',
      elapsedPlies,
      remainingPlies,
      feedback: 'La posición ha terminado en tablas antes de cumplir el objetivo.',
      reason: 'draw',
    };
  }
  if (limit !== null && elapsedPlies >= limit) {
    return {
      status: 'failure',
      elapsedPlies,
      remainingPlies: 0,
      feedback: 'Se agotó el límite de órdenes. Revisa la secuencia y prueba una ruta más directa.',
      reason: 'limit',
    };
  }

  return { status: 'in-progress', elapsedPlies, remainingPlies, feedback };
}

function objectiveAchieved(
  scenarioDefinition: ScenarioDefinition,
  before: GameState,
  after: GameState,
  action: GameAction,
  elapsedPlies: number,
): boolean {
  const objective = scenarioDefinition.objective;
  switch (objective.kind) {
    case 'perform-action':
      return (
        action.kind === objective.actionKind &&
        (!objective.pieceId || action.pieceId === objective.pieceId)
      );
    case 'capture':
      return Boolean(getPiece(before, objective.targetId) && !getPiece(after, objective.targetId));
    case 'damage-fortress': {
      const oldPiece = before.pieces.find(
        (piece) => piece.type === 'fortress' && piece.owner === objective.owner,
      );
      const nextPiece = after.pieces.find(
        (piece) => piece.type === 'fortress' && piece.owner === objective.owner,
      );
      return (
        oldPiece?.type === 'fortress' &&
        (!nextPiece || (nextPiece.type === 'fortress' && nextPiece.hp < oldPiece.hp))
      );
    }
    case 'win':
      return isControlledWin(scenarioDefinition, after);
    case 'win-in':
      return elapsedPlies <= objective.maxPlies && isControlledWin(scenarioDefinition, after);
    case 'survive': {
      const owner = objective.owner ?? scenarioDefinition.controlledPlayer;
      const fortressAlive = after.pieces.some(
        (piece) => piece.type === 'fortress' && piece.owner === owner,
      );
      return elapsedPlies >= objective.plies && fortressAlive;
    }
    case 'protect-piece': {
      const initialPiece = getPiece(scenarioDefinition.initialState, objective.pieceId);
      const currentPiece = getPiece(after, objective.pieceId);
      return Boolean(
        elapsedPlies >= objective.plies &&
        initialPiece &&
        currentPiece &&
        currentPiece.owner === initialPiece.owner,
      );
    }
    case 'reach': {
      const piece = getPiece(after, objective.pieceId);
      return Boolean(
        piece && piece.position.q === objective.target.q && piece.position.r === objective.target.r,
      );
    }
  }
}

function isControlledWin(scenarioDefinition: ScenarioDefinition, state: GameState): boolean {
  return (
    state.outcome?.type === 'win' && state.outcome.winner === scenarioDefinition.controlledPlayer
  );
}

function objectiveLimit(scenarioDefinition: ScenarioDefinition): number | null {
  const objective = scenarioDefinition.objective;
  const objectivePlies =
    objective.kind === 'win-in'
      ? objective.maxPlies
      : objective.kind === 'survive' || objective.kind === 'protect-piece'
        ? objective.plies
        : null;
  if (scenarioDefinition.maxPlies === undefined) return objectivePlies;
  return objectivePlies === null
    ? scenarioDefinition.maxPlies
    : Math.min(scenarioDefinition.maxPlies, objectivePlies);
}

export function scenarioLessonAt(
  scenarioDefinition: ScenarioDefinition,
  elapsedPlies: number,
): string {
  const stage = [...(scenarioDefinition.stages ?? [])]
    .filter((candidate) => candidate.atPly <= elapsedPlies)
    .sort((left, right) => right.atPly - left.atPly)[0];
  return stage?.text ?? scenarioDefinition.lesson ?? scenarioDefinition.summary;
}

export function nextScenarioHint(
  scenarioDefinition: ScenarioDefinition,
  revealedCount: number,
): ProgressiveHint {
  const safeCount = Math.max(
    0,
    Math.min(scenarioDefinition.hints.length, Math.floor(revealedCount)),
  );
  const hint = scenarioDefinition.hints[safeCount] ?? null;
  const nextCount = hint === null ? safeCount : safeCount + 1;
  return {
    hint,
    revealedCount: nextCount,
    total: scenarioDefinition.hints.length,
    exhausted: nextCount >= scenarioDefinition.hints.length,
  };
}

export function revealedScenarioHints(
  scenarioDefinition: ScenarioDefinition,
  revealedCount: number,
): string[] {
  const safeCount = Math.max(
    0,
    Math.min(scenarioDefinition.hints.length, Math.floor(revealedCount)),
  );
  return scenarioDefinition.hints.slice(0, safeCount);
}

export function dailyScenarioForDate(
  date: Date | string = new Date(),
  seed: string | number = 'protocolo-hexagonal',
): ScenarioDefinition {
  const dateKey = localDateKey(date);
  const hash = stableHash(`${dateKey}:${String(seed)}`);
  const template = STRATEGIC_SCENARIOS[hash % STRATEGIC_SCENARIOS.length];
  const daily = structuredClone(template);
  return {
    ...daily,
    id: `daily:${dateKey}:${hash.toString(36)}`,
    title: `Reto diario · ${template.title.replace(/^Desafío · /, '')}`,
    summary: `${template.summary} Disponible hasta medianoche.`,
    category: 'daily',
  };
}

function localDateKey(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError('La fecha del reto diario no es válida.');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
