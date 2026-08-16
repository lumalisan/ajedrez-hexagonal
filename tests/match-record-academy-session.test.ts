import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClassicConfig } from '../src/game-config';
import {
  ReplayError,
  createMatchRecord,
  parseRecord,
  serializeRecord,
  setAcademySession,
} from '../src/match-record';
import type { MatchRecord } from '../src/types';

describe('sesión portable de Academia', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sobrevive una exportación e importación sin mutar el registro original', () => {
    const original = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const withSession = setAcademySession(original, {
      scenarioId: 'batalla-guiada',
      hintsRevealed: 2,
    });

    expect(original.academySession).toBeUndefined();
    expect(withSession).not.toBe(original);
    expect(withSession.academySession).toEqual({
      scenarioId: 'batalla-guiada',
      hintsRevealed: 2,
    });
    expect(withSession.updatedAt).toBe('2026-08-16T15:00:00.000Z');
    expect(parseRecord(serializeRecord(withSession))).toEqual(withSession);
  });

  it('permite borrar el metadato explícitamente', () => {
    const record = setAcademySession(createMatchRecord(createClassicConfig({ mode: 'local' })), {
      scenarioId: 'alcance',
      hintsRevealed: 1,
    });

    const cleared = setAcademySession(record, null);
    expect(cleared.academySession).toBeNull();
    expect(record.academySession).toEqual({ scenarioId: 'alcance', hintsRevealed: 1 });
    expect(parseRecord(serializeRecord(cleared))).toEqual(cleared);
  });

  it('mantiene compatibles los guardados v2 que no incluyen este metadato', () => {
    const legacy = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const parsed = parseRecord(JSON.stringify(legacy));

    expect(parsed.academySession).toBeUndefined();
  });

  it.each([
    '',
    0,
    [],
    {},
    { scenarioId: '', hintsRevealed: 0 },
    { scenarioId: ' escenario ', hintsRevealed: 0 },
    { scenarioId: 'escenario', hintsRevealed: -1 },
    { scenarioId: 'escenario', hintsRevealed: 1.5 },
    { scenarioId: 'escenario', hintsRevealed: '2' },
  ])('rechaza metadatos importados inválidos: %#', (academySession) => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const tampered = { ...record, academySession };

    expect(() => parseRecord(JSON.stringify(tampered))).toThrow(ReplayError);
  });

  it('valida también el helper y la exportación directa', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const invalid = { scenarioId: 'escenario', hintsRevealed: Number.POSITIVE_INFINITY };

    expect(() => setAcademySession(record, invalid)).toThrow(/pistas reveladas/u);
    expect(() => setAcademySession(record, '' as never)).toThrow(ReplayError);
    expect(() => serializeRecord({ ...record, academySession: invalid } as MatchRecord)).toThrow(
      /pistas reveladas/u,
    );
  });
});
