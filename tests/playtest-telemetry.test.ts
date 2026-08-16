import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearTelemetry,
  loadTelemetry,
  recordTelemetry,
  serializeTelemetry,
  telemetrySummary,
  type TelemetryEvent,
} from '../src/playtest-telemetry';
import { installMemoryStorage, type MemoryStorage } from './helpers/memory-storage';

describe('telemetría local de playtest', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = installMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:34:56.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mantiene únicamente los 600 eventos más recientes', () => {
    for (let index = 0; index < 605; index += 1) {
      recordTelemetry('action-committed', { index });
    }

    const events = loadTelemetry();
    expect(events).toHaveLength(600);
    expect(events[0]?.data.index).toBe(5);
    expect(events.at(-1)?.data.index).toBe(604);
  });

  it('resume eventos determinísticamente sin mutar la colección', () => {
    const events: TelemetryEvent[] = [
      { at: 'a', name: 'match-start', data: {} },
      { at: 'b', name: 'action-prepared', data: {} },
      { at: 'c', name: 'action-prepared', data: {} },
      { at: 'd', name: 'match-finished', data: {} },
    ];

    expect(telemetrySummary(events)).toEqual({
      'match-start': 1,
      'action-prepared': 2,
      'match-finished': 1,
    });
    expect(events).toHaveLength(4);
  });

  it('serializa una exportación local con fecha, resumen y eventos', () => {
    recordTelemetry('match-start', { mode: 'skirmish' });
    recordTelemetry('academy-hint', { scenario: 'movimiento', level: 1 });

    expect(JSON.parse(serializeTelemetry())).toEqual({
      version: 1,
      privacy: 'local-only',
      exportedAt: '2026-08-16T12:34:56.000Z',
      summary: { 'match-start': 1, 'academy-hint': 1 },
      events: [
        {
          at: '2026-08-16T12:34:56.000Z',
          name: 'match-start',
          data: { mode: 'skirmish' },
        },
        {
          at: '2026-08-16T12:34:56.000Z',
          name: 'academy-hint',
          data: { scenario: 'movimiento', level: 1 },
        },
      ],
    });
  });

  it('borra todos los diagnósticos y tolera JSON corrupto', () => {
    recordTelemetry('match-start');
    clearTelemetry();
    expect(loadTelemetry()).toEqual([]);

    storage.setItem('protocolo-hexagonal:playtest-v1', '{datos rotos');
    expect(loadTelemetry()).toEqual([]);
    clearTelemetry();
    expect(storage.length).toBe(0);
  });
});
