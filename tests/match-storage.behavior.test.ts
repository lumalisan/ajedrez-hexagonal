import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendMatchHistory,
  loadAcademyProgress,
  loadAcademyRecords,
  loadMatchHistory,
  recordScenarioAttempt,
  removeMatchHistory,
  resetAcademyProgress,
  type MatchHistoryEntry,
} from '../src/match-storage';
import { installMemoryStorage, type MemoryStorage } from './helpers/memory-storage';

describe('persistencia de Academia e historial', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('acumula intentos y pistas, conserva la mejor marca y completa el progreso legado', () => {
    const failed = recordScenarioAttempt('movimiento', {
      completed: false,
      plies: 4,
      hintsUsed: 2,
      parPlies: 3,
    });
    expect(failed).toMatchObject({
      completed: false,
      attempts: 1,
      hintsUsed: 2,
      bestPlies: null,
      medal: null,
    });
    expect(loadAcademyProgress()).toEqual([]);

    const completed = recordScenarioAttempt('movimiento', {
      completed: true,
      plies: 3,
      hintsUsed: 0,
      parPlies: 3,
    });
    expect(completed).toEqual({
      id: 'movimiento',
      completed: true,
      attempts: 2,
      hintsUsed: 2,
      bestPlies: 3,
      medal: 'gold',
      updatedAt: '2026-08-16T12:00:00.000Z',
    });
    expect(loadAcademyProgress()).toEqual(['movimiento']);
    expect(loadAcademyRecords()).toEqual([completed]);
  });

  it.each([
    { id: 'oro', plies: 3, hintsUsed: 0, medal: 'gold' },
    { id: 'plata', plies: 8, hintsUsed: 1, medal: 'silver' },
    { id: 'bronce', plies: 8, hintsUsed: 2, medal: 'bronze' },
  ] as const)('otorga la medalla $medal según órdenes y pistas', (attempt) => {
    expect(
      recordScenarioAttempt(attempt.id, {
        completed: true,
        plies: attempt.plies,
        hintsUsed: attempt.hintsUsed,
        parPlies: 3,
      }).medal,
    ).toBe(attempt.medal);
  });

  it('no degrada una medalla ni una mejor marca ya obtenidas', () => {
    recordScenarioAttempt('dominio', {
      completed: true,
      plies: 2,
      hintsUsed: 0,
      parPlies: 2,
    });
    const laterAttempt = recordScenarioAttempt('dominio', {
      completed: true,
      plies: 7,
      hintsUsed: 3,
      parPlies: 2,
    });

    expect(laterAttempt.bestPlies).toBe(2);
    expect(laterAttempt.medal).toBe('gold');
  });

  it('borra tanto los récords nuevos como el progreso legado', () => {
    recordScenarioAttempt('captura', {
      completed: true,
      plies: 1,
      hintsUsed: 0,
    });
    resetAcademyProgress();

    expect(loadAcademyRecords()).toEqual([]);
    expect(loadAcademyProgress()).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it('ordena el historial por inserción, evita duplicados y conserva solo 30 partidas', () => {
    for (let index = 0; index < 32; index += 1) {
      appendMatchHistory(historyEntry(index));
    }

    const capped = loadMatchHistory();
    expect(capped).toHaveLength(30);
    expect(capped[0]?.id).toBe('match-31');
    expect(capped.at(-1)?.id).toBe('match-2');

    const replacement = {
      ...historyEntry(10),
      durationSeconds: 999,
      completedAt: '2026-08-17T00:00:00.000Z',
    };
    appendMatchHistory(replacement);

    const deduplicated = loadMatchHistory();
    expect(deduplicated).toHaveLength(30);
    expect(deduplicated[0]).toEqual(replacement);
    expect(deduplicated.filter((entry) => entry.id === replacement.id)).toHaveLength(1);
  });

  it('se recupera de datos locales corruptos sin propagar la excepción', () => {
    storage.setItem('atlas-academy-records-v2', '{datos rotos');
    storage.setItem('atlas-match-history-v1', '{datos rotos');

    expect(loadAcademyRecords()).toEqual([]);
    expect(loadMatchHistory()).toEqual([]);
  });

  it('retira una partida reabierta sin modificar las demás y permite registrar su nuevo final', () => {
    const older = historyEntry(1);
    const reopened = historyEntry(2);
    const newer = historyEntry(3);
    appendMatchHistory(older);
    appendMatchHistory(reopened);
    appendMatchHistory(newer);

    expect(removeMatchHistory(reopened.id)).toBe(true);
    expect(loadMatchHistory()).toEqual([newer, older]);
    expect(removeMatchHistory('partida-inexistente')).toBe(true);
    expect(loadMatchHistory()).toEqual([newer, older]);

    const completedAgain = { ...reopened, plies: 10, durationSeconds: 120 };
    appendMatchHistory(completedAgain);
    expect(loadMatchHistory()).toEqual([completedAgain, newer, older]);
  });

  it('informa del fallo al retirar una partida sin perder el historial guardado', () => {
    const entry = historyEntry(1);
    appendMatchHistory(entry);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Almacenamiento no disponible', 'SecurityError');
    });

    expect(removeMatchHistory(entry.id)).toBe(false);
    expect(loadMatchHistory()).toEqual([entry]);
  });

  it('mantiene resultados útiles cuando la cuota impide escribir', () => {
    const quotaError = new DOMException('Cuota agotada', 'QuotaExceededError');
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    const attempt = recordScenarioAttempt('sin-espacio', {
      completed: true,
      plies: 2,
      hintsUsed: 0,
      parPlies: 3,
    });
    const entry = historyEntry(99);

    expect(attempt).toMatchObject({
      id: 'sin-espacio',
      completed: true,
      attempts: 1,
      bestPlies: 2,
      medal: 'gold',
    });
    expect(appendMatchHistory(entry)).toEqual(entry);
    expect(setItem).toHaveBeenCalledTimes(3);
    expect(loadAcademyRecords()).toEqual([]);
    expect(loadAcademyProgress()).toEqual([]);
    expect(loadMatchHistory()).toEqual([]);
  });
});

function historyEntry(index: number): MatchHistoryEntry {
  return {
    id: `match-${index}`,
    definitionId: index % 2 === 0 ? 'skirmish' : 'classic',
    participants: ['Comando Cian', 'Comando Ámbar'],
    outcome:
      index % 2 === 0
        ? { type: 'win', winner: 0, reason: 'fortress' }
        : { type: 'draw', reason: 'repetition' },
    plies: index + 1,
    durationSeconds: index * 10,
    completedAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
  };
}
