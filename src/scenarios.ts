import { createGameState, getPiece } from './engine';
import type {
  GameAction,
  GameState,
  Piece,
  Player,
  ScenarioDefinition,
  ScenarioObjective,
} from './types';

const fortress = (id: string, owner: Player, q: number, r: number, hp: 1 | 2 = 2): Piece => ({
  id,
  type: 'fortress',
  owner,
  position: { q, r },
  hp,
});
const soldier = (
  id: string,
  owner: Player,
  q: number,
  r: number,
  facing: 0 | 1 | 2 | 3 | 4 | 5,
): Piece => ({ id, type: 'soldier', owner, position: { q, r }, facing });

function scenario(
  id: string,
  title: string,
  summary: string,
  pieces: Piece[],
  objective: ScenarioObjective,
  hints: string[],
  successText: string,
  maxPlies = 4,
): ScenarioDefinition {
  return {
    id,
    title,
    summary,
    controlledPlayer: 0,
    initialState: createGameState([
      fortress('academy-blue-fortress', 0, -5, 0),
      fortress('academy-amber-fortress', 1, 5, 0),
      ...pieces,
    ]),
    objective,
    maxPlies,
    hints,
    successText,
  };
}

export const SCENARIOS: ScenarioDefinition[] = [
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
    'Has movido y reorientado el Soldado.',
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
    'Conversión completada sin desplazamiento.',
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
      'Su cañón cubre un abanico frontal de hasta dos casillas.',
      'Elige el objetivo rosa y confirma. Disparar no desplaza el tanque.',
    ],
    'Objetivo neutralizado con el Tanque.',
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
    'Has dominado el alcance exacto.',
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
      'Los Drones vuelan hasta tres casillas y pueden pasar sobre otras unidades.',
      'Muévelo a la casilla de tu Soldado: ambos quedarán apilados en capas distintas.',
    ],
    'Apilamiento aéreo completado.',
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
    'La intercepción antiaérea funciona automáticamente.',
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
    'La tripulación continúa como Soldado.',
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
    'Asalto completado. La Fortaleza ha caído.',
  ),
];

export function scenarioById(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((scenarioDefinition) => scenarioDefinition.id === id);
}

export function evaluateScenario(
  scenarioDefinition: ScenarioDefinition,
  before: GameState,
  after: GameState,
  action: GameAction,
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
      return (
        after.outcome?.type === 'win' &&
        after.outcome.winner === scenarioDefinition.controlledPlayer
      );
  }
}
