import type * as Engine from '../../src/engine';
import type * as Setup from '../../src/setup';
import type { SearchMetadata } from '../../src/ai';
import type { GameAction, GameState, Outcome, Player } from '../../src/types';

export const EXPERT_BUDGET_MS: number;
export const EXPERT_DEPTH: number;
export const TEACHER_SCALE: number;

export interface ArgumentDefinition {
  type: 'boolean' | 'number' | 'string';
  default?: string | number | boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  required?: boolean;
}

export function parseArguments(
  argv: string[],
  definitions: Record<string, ArgumentDefinition>,
): Record<string, string | number | boolean>;
export function seededRandom(seed: number): () => number;
export function deriveSeed(seed: number, index: number): number;
export function normalizedTeacher(score: number): number;
export function validateSparseFeatures(features: number[], inputSize: number): void;
export function outcomeForPerspective(outcome: Outcome | null, perspective: Player): number | null;
export function summarizeArena(
  games: ReadonlyArray<{ outcome: Outcome | null; neuralPlayer: Player }>,
): {
  wins: number;
  draws: number;
  losses: number;
  inconclusive: number;
  completed: number;
  score: number | null;
  scoreInterval95: [number, number] | null;
  intervalMethod: string;
  interpretation: string;
};

export interface SearchMetrics {
  searches: number;
  elapsedMs: number;
  nodes: number;
  depthSum: number;
  maxDepth: number;
  timedOut: number;
  depthZero: number;
}
export function newSearchMetrics(): SearchMetrics;
export function addSearchMetrics(metrics: SearchMetrics, metadata: SearchMetadata): void;
export function describeSearchMetrics(metrics: SearchMetrics): SearchMetrics & {
  averageDepth: number | null;
  averageElapsedMs: number | null;
};

export function createOpening(
  modules: { engine: typeof Engine; setup: typeof Setup },
  options: { seed: number; index: number; openingPlies: number; fortressHp?: 1 | 2 | 3 },
): {
  seed: number;
  initialLayout: 3 | 5;
  fortressHp: 1 | 2 | 3;
  initialState: GameState;
  actions: GameAction[];
  state: GameState;
};
export function applySearchAction(
  modules: { engine: typeof Engine },
  state: GameState,
  action: GameAction | null,
  rules: Readonly<Engine.ActionResolutionRules>,
): GameState;
export const commonArguments: Record<string, ArgumentDefinition>;
