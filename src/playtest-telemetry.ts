export type TelemetryEventName =
  | 'match-start'
  | 'action-prepared'
  | 'action-cancelled'
  | 'action-committed'
  | 'match-finished'
  | 'academy-hint'
  | 'academy-finished'
  | 'analysis-opened'
  | 'analysis-branched';

export interface TelemetryEvent {
  at: string;
  name: TelemetryEventName;
  data: Record<string, string | number | boolean | null>;
}

const STORAGE_KEY = 'protocolo-hexagonal:playtest-v1';
const MAX_EVENTS = 600;

/** Local-only diagnostics. Nothing is transmitted and players can export or erase it. */
export function recordTelemetry(name: TelemetryEventName, data: TelemetryEvent['data'] = {}): void {
  try {
    const events = loadTelemetry();
    events.push({ at: new Date().toISOString(), name, data });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics must never interfere with play.
  }
}

export function loadTelemetry(): TelemetryEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : [];
  } catch {
    return [];
  }
}

export function clearTelemetry(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

export function telemetrySummary(events = loadTelemetry()): Record<string, number> {
  return events.reduce<Record<string, number>>((summary, event) => {
    summary[event.name] = (summary[event.name] ?? 0) + 1;
    return summary;
  }, {});
}

export function serializeTelemetry(): string {
  return JSON.stringify(
    {
      version: 1,
      privacy: 'local-only',
      exportedAt: new Date().toISOString(),
      summary: telemetrySummary(),
      events: loadTelemetry(),
    },
    null,
    2,
  );
}
