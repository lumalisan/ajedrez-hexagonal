import { createMatchRecord } from './match-record';
import type { GameState, MatchConfig, ScenarioObjective } from './types';

const CATALOG_KEY = 'atlas-scenario-catalog-v2';

export interface CustomScenario {
  version: 2;
  id: string;
  title: string;
  summary?: string;
  config: MatchConfig;
  initialState: GameState;
  objective?: ScenarioObjective;
  maxPlies?: number;
  hints?: string[];
  successText?: string;
}

export function validateCustomScenario(value: CustomScenario): CustomScenario {
  if (value.version !== 2) throw new Error('Versión de escenario incompatible.');
  if (!value.id?.trim() || !value.title?.trim())
    throw new Error('El escenario necesita identificador y título.');
  if (value.maxPlies !== undefined && (!Number.isInteger(value.maxPlies) || value.maxPlies < 1)) {
    throw new Error('El límite de órdenes debe ser un entero positivo.');
  }
  if (value.hints !== undefined && !Array.isArray(value.hints)) {
    throw new Error('Las pistas del escenario deben ser una lista.');
  }
  if (value.objective) validateObjective(value.objective);
  const objective = value.objective;
  if (objective?.kind === 'protect-piece' || objective?.kind === 'reach') {
    if (!value.initialState.pieces.some((piece) => piece.id === objective.pieceId)) {
      throw new Error('La unidad indicada por el objetivo no existe en la posición.');
    }
  }
  if (objective?.kind === 'reach') {
    const target = objective.target;
    if (!value.config.board.cells.some((cell) => cell.q === target.q && cell.r === target.r)) {
      throw new Error('El destino del objetivo está fuera del tablero.');
    }
  }
  createMatchRecord(value.config, value.initialState);
  return structuredClone(value);
}

function validateObjective(objective: ScenarioObjective): void {
  switch (objective.kind) {
    case 'win-in':
      if (!Number.isInteger(objective.maxPlies) || objective.maxPlies < 1) {
        throw new Error('El objetivo «ganar en» necesita un límite positivo.');
      }
      return;
    case 'survive':
    case 'protect-piece':
      if (!Number.isInteger(objective.plies) || objective.plies < 1) {
        throw new Error('El objetivo necesita una duración positiva.');
      }
      return;
    case 'reach':
      if (!Number.isInteger(objective.target.q) || !Number.isInteger(objective.target.r)) {
        throw new Error('El destino del objetivo debe usar coordenadas enteras.');
      }
      return;
    default:
      return;
  }
}

export function loadScenarioCatalog(): CustomScenario[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      try {
        return [validateCustomScenario(candidate as CustomScenario)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveCustomScenario(scenario: CustomScenario): void {
  const valid = validateCustomScenario(scenario);
  const catalog = loadScenarioCatalog().filter((entry) => entry.id !== valid.id);
  catalog.push(valid);
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
}
