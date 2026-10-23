import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import { createBenchmarkCases } from '../scripts/ai/benchmark-cases.mjs';
import {
  auditThreatPreference,
  loadDiagnosticModules,
  selectionProbe,
} from '../scripts/ai/diagnose.mjs';

describe('read-only search diagnosis', () => {
  it('distinguishes creating a firing threat from forcing the target to remain in range', () => {
    const position = createBenchmarkCases(engine).find(
      (entry) => entry.id === 'tank-create-firing-line',
    );
    const snapshot = JSON.stringify(position);
    const threats = auditThreatPreference(engine, position);
    expect(threats.length).toBeGreaterThan(0);
    expect(threats.every((entry) => entry.repliesAvoidingTheShot > 0)).toBe(true);
    for (const entry of threats) {
      const after = engine.applyAction(position.state, entry.action, position.rules).state;
      expect(engine.applyAction(after, entry.exampleEvasion, position.rules).ok).toBe(true);
    }
    expect(JSON.stringify(position)).toBe(snapshot);
  });

  it('probes the actual private selector in memory without changing the production source', async () => {
    const before = readFileSync(new URL('../src/ai.ts', import.meta.url), 'utf8');
    const modules = await loadDiagnosticModules();
    try {
      const position = createBenchmarkCases(modules.engine).find(
        (entry) => entry.id === 'fast-terminal',
      );
      const winning = modules.engine
        .getAllLegalActions(position.state)
        .find(
          (action) =>
            modules.engine.applyAction(position.state, action, position.rules).state.outcome
              ?.winner === 1,
        );
      const probe = selectionProbe(modules.ai, modules.engine, position, winning, 1);
      expect(probe.teacherActionRetained).toBe(true);
      expect(probe.actualSearchTrace).toBe(false);
      expect(probe.retainedActions).toBeLessThan(probe.legalActions);
      expect(readFileSync(new URL('../src/ai.ts', import.meta.url), 'utf8')).toBe(before);
    } finally {
      await modules.close();
    }
  });
});
