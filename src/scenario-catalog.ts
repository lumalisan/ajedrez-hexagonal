import { createMatchRecord } from './match-record';
import type { GameState, MatchConfig } from './types';

const CATALOG_KEY = 'atlas-scenario-catalog-v1';

export interface CustomScenario {
  version: 1;
  id: string;
  title: string;
  config: MatchConfig;
  initialState: GameState;
}

export function validateCustomScenario(value: CustomScenario): CustomScenario {
  if (value.version !== 1) throw new Error('Versión de escenario incompatible.');
  if (!value.id?.trim() || !value.title?.trim())
    throw new Error('El escenario necesita identificador y título.');
  createMatchRecord(value.config, value.initialState);
  return structuredClone(value);
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
