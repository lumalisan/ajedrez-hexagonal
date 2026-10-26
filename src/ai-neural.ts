import { DEFAULT_ACTION_RESOLUTION_RULES, type ActionResolutionRules } from './engine.js';
import { allBoardHexes } from './hex.js';
import { evaluateClassicState } from './ai.js';
import { evaluateNeuralMaterialBaseline, NEURAL_MATERIAL_BASELINE } from './ai-neural-baseline.js';
import type { Direction, GameState, Piece, Player } from './types.js';

/** Change this identifier whenever the meaning or order of an input changes. */
export const NEURAL_FEATURE_SCHEMA = 'hex-sparse-v1';
export const NEURAL_INPUT_SIZE = 5_183;
export const NEURAL_FEATURE_SCHEMA_V2 = 'hex-sparse-v2';
export const NEURAL_INPUT_SIZE_V2 = 5_203;
export { evaluateNeuralMaterialBaseline, NEURAL_MATERIAL_BASELINE };
export type NeuralFeatureSchema = typeof NEURAL_FEATURE_SCHEMA | typeof NEURAL_FEATURE_SCHEMA_V2;

const BOARD_CELLS = 91;
const PIECE_VARIANTS = 28;
const HIDDEN_1 = 64;
const HIDDEN_2 = 32;
const OUTPUT_SCALE = 10_000;
const GLOBAL_OFFSET = BOARD_CELLS * PIECE_VARIANTS * 2;
const cellIndices = new Int16Array(121).fill(-1);
for (const [index, cell] of allBoardHexes().entries()) {
  cellIndices[(cell.q + 5) * 11 + cell.r + 5] = index;
}

interface NeuralModelMetadataBase {
  readonly format: 'hex-value-v1';
  readonly hiddenSizes: readonly [64, 32];
  readonly outputScale: 10_000;
  readonly training?: Readonly<Record<string, unknown>>;
  readonly evaluation?: 'classic-residual-v1' | 'direct-value-v1' | 'material-residual-v1';
  readonly residualScale?: number;
  readonly residualBaseline?: string;
  readonly residualSymmetry?: 'antisymmetric';
  readonly includesRangedValue?: true;
  readonly searchProfile?: 'pvs-history' | 'pvs-threats';
}

export type NeuralModelMetadata = NeuralModelMetadataBase &
  (
    | {
        readonly featureSchema: typeof NEURAL_FEATURE_SCHEMA;
        readonly inputSize: typeof NEURAL_INPUT_SIZE;
      }
    | {
        readonly featureSchema: typeof NEURAL_FEATURE_SCHEMA_V2;
        readonly inputSize: typeof NEURAL_INPUT_SIZE_V2;
      }
  );

export interface NeuralModel {
  readonly metadata: NeuralModelMetadata;
  /** Input-major: each active input contributes one contiguous row of 64 weights. */
  readonly weights1: Float32Array;
  readonly bias1: Float32Array;
  readonly weights2: Float32Array;
  readonly bias2: Float32Array;
  readonly weights3: Float32Array;
  readonly bias3: number;
}

export type NeuralEvaluator = ((
  state: GameState,
  player: Player,
  rules?: Readonly<ActionResolutionRules>,
) => number) & {
  searchProfile?: 'pvs-history' | 'pvs-threats';
  /** The estimate already includes the ranged value; tactical move selection stays enabled. */
  includesRangedValue?: boolean;
};

function relativeDirection(direction: Direction, perspective: Player): number {
  return perspective === 0 ? direction : (direction + 3) % 6;
}

function pieceVariant(piece: Piece, perspective: Player): number {
  switch (piece.type) {
    case 'soldier':
      return relativeDirection(piece.facing, perspective);
    case 'capturer':
      return 6;
    case 'medium':
      return 7 + relativeDirection(piece.cannon, perspective);
    case 'long':
      return 13 + (piece.missilesRemaining ?? 2);
    case 'fast':
      return 16;
    case 'drone':
      return 17;
    case 'airplane':
      return 18 + relativeDirection(piece.facing, perspective);
    case 'antiAir':
      return 24;
    case 'fortress':
      return 25 + piece.hp - 1;
  }
}

/**
 * Binary sparse inputs, independent of piece IDs and history text. Cells follow
 * allBoardHexes(); each ownership plane contains 91 cells with 28 variants.
 * Perspective 1 rotates coordinates and directions by 180 degrees.
 *
 * Global one-hot groups after the 5,096 board inputs:
 * turn [2], first Fortress damage [3], no-progress count / 8 [17],
 * maximum repetition [4], number of repeated positions [17],
 * repetition limit [9], no-progress limit / 8 [18], ply / 16 [17].
 * Counter buckets saturate; null rule limits have their own bucket. Repetition
 * is a summary, never a replacement for the engine's exact terminal checks.
 * V2 preserves every V1 index and appends orientation-only rule enabled [2],
 * own remaining orders [9], opponent remaining orders [9]. Remaining orders
 * use buckets 0..7 and >=8; a missing/null limit disables the rule and both counts.
 */
export function encodeNeuralFeatures(
  state: GameState,
  perspective: Player,
  rules: Readonly<ActionResolutionRules> = DEFAULT_ACTION_RESOLUTION_RULES,
  schema: NeuralFeatureSchema = NEURAL_FEATURE_SCHEMA,
): number[] {
  if (schema !== NEURAL_FEATURE_SCHEMA && schema !== NEURAL_FEATURE_SCHEMA_V2) {
    throw new Error('Esquema de características neuronales incompatible.');
  }
  const features: number[] = [];
  for (const piece of state.pieces) {
    const q = perspective === 0 ? piece.position.q : -piece.position.q;
    const r = perspective === 0 ? piece.position.r : -piece.position.r;
    const cellIndex = cellIndices[(q + 5) * 11 + r + 5];
    if (q < -5 || q > 5 || r < -5 || r > 5 || cellIndex === undefined || cellIndex < 0) {
      throw new Error('No se puede evaluar una pieza fuera del tablero neuronal.');
    }
    const relativeOwner = piece.owner === perspective ? 0 : 1;
    features.push(
      (relativeOwner * BOARD_CELLS + cellIndex) * PIECE_VARIANTS + pieceVariant(piece, perspective),
    );
  }

  let maximumRepetition = 0;
  let repeatedPositions = 0;
  for (const key in state.positionCounts) {
    const count = state.positionCounts[key];
    maximumRepetition = Math.max(maximumRepetition, count);
    if (count >= 2) repeatedPositions += 1;
  }
  const firstDamage =
    state.firstFortressDamageBy === null ? 0 : state.firstFortressDamageBy === perspective ? 1 : 2;
  features.push(
    GLOBAL_OFFSET + (state.activePlayer === perspective ? 0 : 1),
    GLOBAL_OFFSET + 2 + firstDamage,
    GLOBAL_OFFSET + 5 + Math.min(16, Math.floor((state.noProgressPlyCount ?? 0) / 8)),
    GLOBAL_OFFSET + 22 + Math.min(3, maximumRepetition),
    GLOBAL_OFFSET + 26 + Math.min(16, repeatedPositions),
    GLOBAL_OFFSET + 43 + (rules.repetition === null ? 0 : Math.min(8, rules.repetition)),
    GLOBAL_OFFSET +
      52 +
      (rules.noProgressPlyLimit === null
        ? 0
        : Math.min(17, 1 + Math.floor(rules.noProgressPlyLimit / 8))),
    GLOBAL_OFFSET + 70 + Math.min(16, Math.floor(state.ply / 16)),
  );
  if (schema === NEURAL_FEATURE_SCHEMA_V2) {
    const limit = rules.orientationOnlyTurnLimit;
    const enabled = limit != null;
    const remaining = (player: Player): number =>
      enabled ? Math.min(8, Math.max(0, limit - (state.orientationOnlyTurns?.[player] ?? 0))) : 0;
    features.push(
      NEURAL_INPUT_SIZE + (enabled ? 1 : 0),
      NEURAL_INPUT_SIZE + 2 + remaining(perspective),
      NEURAL_INPUT_SIZE + 11 + remaining(perspective === 0 ? 1 : 0),
    );
  }
  return features;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMetadata(value: unknown): asserts value is NeuralModelMetadata {
  if (
    !isObject(value) ||
    value.format !== 'hex-value-v1' ||
    !(
      (value.featureSchema === NEURAL_FEATURE_SCHEMA && value.inputSize === NEURAL_INPUT_SIZE) ||
      (value.featureSchema === NEURAL_FEATURE_SCHEMA_V2 && value.inputSize === NEURAL_INPUT_SIZE_V2)
    ) ||
    !Array.isArray(value.hiddenSizes) ||
    value.hiddenSizes.length !== 2 ||
    value.hiddenSizes[0] !== HIDDEN_1 ||
    value.hiddenSizes[1] !== HIDDEN_2 ||
    value.outputScale !== OUTPUT_SCALE ||
    (value.residualBaseline !== undefined && typeof value.residualBaseline !== 'string') ||
    (value.residualSymmetry !== undefined &&
      (value.residualSymmetry !== 'antisymmetric' ||
        (value.evaluation !== 'classic-residual-v1' &&
          value.evaluation !== 'direct-value-v1' &&
          value.evaluation !== 'material-residual-v1'))) ||
    (value.searchProfile !== undefined &&
      value.searchProfile !== 'pvs-history' &&
      value.searchProfile !== 'pvs-threats') ||
    ((value.evaluation === 'classic-residual-v1' || value.evaluation === 'material-residual-v1') &&
      (typeof value.residualScale !== 'number' ||
        !Number.isFinite(value.residualScale) ||
        value.residualScale <= 0 ||
        value.residualScale > 5000)) ||
    (value.evaluation === 'material-residual-v1' &&
      (value.residualBaseline !== NEURAL_MATERIAL_BASELINE ||
        value.residualSymmetry !== 'antisymmetric' ||
        value.includesRangedValue !== true)) ||
    (value.evaluation === 'direct-value-v1' &&
      (value.residualScale !== undefined ||
        value.residualSymmetry !== 'antisymmetric' ||
        value.includesRangedValue !== true)) ||
    (value.evaluation !== undefined &&
      value.evaluation !== 'classic-residual-v1' &&
      value.evaluation !== 'direct-value-v1' &&
      value.evaluation !== 'material-residual-v1') ||
    (value.includesRangedValue !== undefined &&
      ((value.evaluation !== 'direct-value-v1' && value.evaluation !== 'material-residual-v1') ||
        value.includesRangedValue !== true)) ||
    (value.training !== undefined && !isObject(value.training))
  ) {
    throw new Error('Metadatos del modelo neuronal incompatibles.');
  }
}

/** Load HXNN: uint32LE JSON length, UTF-8 JSON, zero padding, Float32LE weights. */
export function parseNeuralModel(bytes: ArrayBuffer): NeuralModel {
  const view = new DataView(bytes);
  if (
    view.byteLength < 8 ||
    view.getUint32(0, false) !== 0x48584e4e // HXNN
  ) {
    throw new Error('Cabecera del modelo neuronal inválida.');
  }
  const metadataLength = view.getUint32(4, true);
  if (metadataLength === 0 || metadataLength > 65_536 || 8 + metadataLength > bytes.byteLength) {
    throw new Error('Longitud de metadatos del modelo neuronal inválida.');
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 8, metadataLength)),
    );
  } catch {
    throw new Error('JSON del modelo neuronal inválido.');
  }
  validateMetadata(metadata);
  let offset = Math.ceil((8 + metadataLength) / 4) * 4;
  const parameterCount =
    metadata.inputSize * HIDDEN_1 + HIDDEN_1 + HIDDEN_1 * HIDDEN_2 + HIDDEN_2 + HIDDEN_2 + 1;
  if (bytes.byteLength !== offset + parameterCount * 4) {
    throw new Error('Tamaño de pesos del modelo neuronal inválido.');
  }
  for (let index = 8 + metadataLength; index < offset; index += 1) {
    if (view.getUint8(index) !== 0) throw new Error('Relleno del modelo neuronal inválido.');
  }
  function readWeights(count: number): Float32Array {
    const weights = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const value = view.getFloat32(offset, true);
      if (!Number.isFinite(value)) throw new Error('Pesos del modelo neuronal no finitos.');
      weights[index] = value;
      offset += 4;
    }
    return weights;
  }
  return {
    metadata,
    weights1: readWeights(metadata.inputSize * HIDDEN_1),
    bias1: readWeights(HIDDEN_1),
    weights2: readWeights(HIDDEN_1 * HIDDEN_2),
    bias2: readWeights(HIDDEN_2),
    weights3: readWeights(HIDDEN_2),
    bias3: readWeights(1)[0],
  };
}

/** Synchronous sparse CPU inference. Callers supply unique active input indices. */
export function createSparseNeuralEvaluator(
  modelBytes: ArrayBuffer,
): (features: readonly number[]) => number {
  return sparseEvaluatorForModel(parseNeuralModel(modelBytes));
}

function sparseEvaluatorForModel(model: NeuralModel): (features: readonly number[]) => number {
  // Double precision accumulation also keeps arbitrary finite Float32 weights
  // finite in the hidden layers. Stored/trained parameters remain Float32.
  const hidden1 = new Float64Array(HIDDEN_1);
  const hidden2 = new Float64Array(HIDDEN_2);
  return (features) => {
    hidden1.set(model.bias1);
    for (const input of features) {
      if (!Number.isInteger(input) || input < 0 || input >= model.metadata.inputSize) {
        throw new Error('Índice de entrada del modelo neuronal inválido.');
      }
      const rowOffset = input * HIDDEN_1;
      for (let neuron = 0; neuron < HIDDEN_1; neuron += 1) {
        hidden1[neuron] += model.weights1[rowOffset + neuron];
      }
    }
    hidden2.set(model.bias2);
    for (let input = 0; input < HIDDEN_1; input += 1) {
      const activation = Math.max(0, hidden1[input]);
      if (activation === 0) continue;
      for (let neuron = 0; neuron < HIDDEN_2; neuron += 1) {
        hidden2[neuron] += activation * model.weights2[input * HIDDEN_2 + neuron];
      }
    }
    let output = model.bias3;
    for (let neuron = 0; neuron < HIDDEN_2; neuron += 1) {
      output += Math.max(0, hidden2[neuron]) * model.weights3[neuron];
    }
    return Math.tanh(output) * OUTPUT_SCALE;
  };
}

/** Evaluates a position inside the AI Worker, reusing the inference buffers. */
export function createNeuralEvaluator(modelBytes: ArrayBuffer): NeuralEvaluator {
  const model = parseNeuralModel(modelBytes);
  const { metadata } = model;
  const evaluateFeatures = sparseEvaluatorForModel(model);
  const evaluate: NeuralEvaluator = (state, player, rules) => {
    if (state.outcome) return evaluateClassicState(state, player);
    let estimate = evaluateFeatures(
      encodeNeuralFeatures(state, player, rules, metadata.featureSchema),
    );
    if (metadata.residualSymmetry === 'antisymmetric') {
      const opposite = evaluateFeatures(
        encodeNeuralFeatures(state, player === 0 ? 1 : 0, rules, metadata.featureSchema),
      );
      estimate = (estimate - opposite) / 2;
    }
    return metadata.evaluation === 'classic-residual-v1'
      ? evaluateClassicState(state, player) + (estimate * metadata.residualScale!) / OUTPUT_SCALE
      : metadata.evaluation === 'material-residual-v1'
        ? evaluateNeuralMaterialBaseline(state, player) +
          (estimate * metadata.residualScale!) / OUTPUT_SCALE
        : estimate;
  };
  evaluate.searchProfile = metadata.searchProfile;
  evaluate.includesRangedValue = metadata.includesRangedValue === true;
  return evaluate;
}
