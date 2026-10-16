import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllLegalActions } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import {
  appendAction,
  concludeMatch,
  createMatchRecord,
  replayRecord,
  serializeRecord,
} from '../src/match-record';
import {
  clearActiveMatch,
  loadMatchHistory,
  loadPendingMatches,
  resumePendingMatch,
  saveActiveMatch,
} from '../src/match-storage';
import { installMemoryStorage } from './helpers/memory-storage';

const day = 24 * 60 * 60 * 1000;
describe('partidas pendientes', () => {
  beforeEach(() => {
    installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const match = (mode: 'local' | 'machine' = 'local') =>
    createMatchRecord(createClassicConfig({ mode }));
  it('conserva varias partidas al iniciar otra y actualiza sin duplicados', () => {
    const first = match();
    saveActiveMatch(first);
    clearActiveMatch();
    vi.advanceTimersByTime(1000);
    const second = match();
    saveActiveMatch(second);
    saveActiveMatch(second);
    expect(loadPendingMatches().map((p) => p.record.createdAt)).toEqual([
      second.createdAt,
      first.createdAt,
    ]);
    expect(resumePendingMatch(first.createdAt)?.createdAt).toBe(first.createdAt);
  });
  it('migra el guardado anterior sin perder su fecha', () => {
    const record = match();
    localStorage.setItem('atlas-match-classic-v2', serializeRecord(record));
    expect(loadPendingMatches()).toEqual([{ record, resumedAt: record.updatedAt }]);
  });
  it('migra el guardado anterior antes de guardar una partida distinta', () => {
    const legacy = match();
    localStorage.setItem('atlas-match-classic-v2', serializeRecord(legacy));
    vi.advanceTimersByTime(1000);
    const next = match();
    saveActiveMatch(next);
    expect(loadPendingMatches().map((entry) => entry.record.createdAt)).toEqual([
      next.createdAt,
      legacy.createdAt,
    ]);
  });
  it('vence después de 30 días y conserva una derrota reproducible para el humano', () => {
    const record = match('machine');
    record.activeDurationMs = 90_000;
    saveActiveMatch(record);
    vi.advanceTimersByTime(30 * day);
    expect(loadPendingMatches()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(loadPendingMatches()).toHaveLength(0);
    const result = loadMatchHistory()[0];
    expect(result.durationSeconds).toBe(90);
    expect(result.outcome).toEqual({ type: 'win', winner: 1, reason: 'resignation' });
    expect(replayRecord(result.record!).outcome).toEqual(result.outcome);
    expect(resumePendingMatch(record.createdAt)).toBeNull();
    expect(loadMatchHistory()).toHaveLength(1);
  });
  it('la caducidad local cuenta como derrota de Cian aunque sea el turno de Ámbar', () => {
    let record = match();
    const action = getAllLegalActions(replayRecord(record)).find((a) => a.kind === 'rotate')!;
    record = appendAction(record, action);
    expect(replayRecord(record).activePlayer).toBe(1);
    saveActiveMatch(record);
    vi.advanceTimersByTime(30 * day + 1);
    loadPendingMatches();
    expect(loadMatchHistory()[0].outcome).toMatchObject({ winner: 1 });
  });

  it('renueva el plazo al retomar y no al guardar', () => {
    const record = match();
    saveActiveMatch(record);
    vi.advanceTimersByTime(29 * day);
    resumePendingMatch(record.createdAt);
    saveActiveMatch(record);
    vi.advanceTimersByTime(2 * day);
    expect(loadPendingMatches()).toHaveLength(1);
    vi.advanceTimersByTime(29 * day);
    expect(loadPendingMatches()).toHaveLength(0);
  });
  it('guardar sin retomar no renueva el plazo', () => {
    const record = match();
    saveActiveMatch(record);
    vi.advanceTimersByTime(29 * day);
    saveActiveMatch(record);
    vi.advanceTimersByTime(2 * day);
    expect(loadPendingMatches()).toHaveLength(0);
  });
  it('retira una partida concluida y conserva las otras', () => {
    const first = match();
    saveActiveMatch(first);
    vi.advanceTimersByTime(1000);
    const second = match();
    saveActiveMatch(second);
    saveActiveMatch(concludeMatch(first, { type: 'win', winner: 1, reason: 'resignation' }));
    expect(loadPendingMatches().map((p) => p.record.createdAt)).toEqual([second.createdAt]);
  });
  it('ignora entradas corruptas sin ocultar las válidas', () => {
    const record = match();
    saveActiveMatch(record);
    const entries = loadPendingMatches();
    localStorage.setItem(
      'atlas-pending-matches-v1',
      JSON.stringify([null, { record: {}, resumedAt: 'bad' }, ...entries]),
    );
    expect(loadPendingMatches()).toHaveLength(1);
  });
});
