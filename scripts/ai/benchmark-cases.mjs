import { readFileSync } from 'node:fs';

export const BENCHMARK_VERSION = 'hex-ai-benchmark-cases-v1';
export const BENCHMARK_RULES = {
  repetition: null,
  noProgressPlyLimit: null,
  orientationOnlyTurnLimit: 5,
};

export function objectiveStrength(objective) {
  return ['win-now', 'no-immediate-loss', 'preserve-piece', 'safe-piece', 'safe-type'].includes(
    objective.kind,
  )
    ? 'tactical-proof'
    : 'strategic-preference';
}

/** Public regression families, not an unseen independent test set. */
export function createBenchmarkCases(engine) {
  const forts = [
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 3 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 3 },
  ];
  const entries = [];
  function add(id, family, category, pieces, objective, source, player = 0) {
    entries.push({
      id,
      family,
      category,
      partition: ['fortress-defense', 'recorded-poisoned', 'ammunition-conversion'].includes(family)
        ? 'reserved'
        : 'development',
      source,
      provenance: 'public-regression; not an independent holdout',
      state: engine.createGameState(pieces, player),
      rules: { ...BENCHMARK_RULES },
      objective,
      objectiveStrength: objectiveStrength(objective),
    });
  }
  add(
    'fast-terminal',
    'fortress-immediate',
    'finales',
    [
      ...forts.map((piece) => ({ ...piece, hp: 1 })),
      { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: -3 } },
    ],
    { kind: 'win-now' },
    'tests/ai-strategic.test.ts: immediate Fortress sacrifice',
    1,
  );
  add(
    'missile-terminal-over-aircraft',
    'fortress-missile',
    'victoria-fortaleza',
    [
      forts[0],
      { ...forts[1], position: { q: 0, r: 3 }, hp: 1 },
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 3, r: -3 }, facing: 3 },
    ],
    { kind: 'win-now' },
    'tests/ai-ranged.test.ts: Fortress over suppression',
  );
  for (const type of ['soldier', 'capturer']) {
    add(
      `${type}-terminal`,
      'fortress-contact',
      'finales',
      [
        forts[0],
        { ...forts[1], position: { q: 0, r: 1 }, hp: 1 },
        {
          id: 'attacker',
          type,
          owner: 0,
          position: { q: 0, r: 0 },
          ...(type === 'soldier' ? { facing: 3 } : {}),
        },
      ],
      { kind: 'win-now' },
      'src/classic-rules.ts: contact Fortress damage',
    );
  }
  add(
    'quiet-fortress-block',
    'fortress-defense',
    'defensa-fortaleza',
    [
      { ...forts[0], hp: 2 },
      { ...forts[1], hp: 1 },
      { id: 'tank', type: 'medium', owner: 1, position: { q: 1, r: 3 }, cannon: 2 },
      { id: 'capturer', type: 'capturer', owner: 1, position: { q: 1, r: 4 } },
      { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 2 } },
      { id: 'human-soldier', type: 'soldier', owner: 0, position: { q: -4, r: 0 }, facing: 3 },
    ],
    { kind: 'no-immediate-loss' },
    'tests/ai.test.ts: quiet Fortress block',
    1,
  );
  add(
    'free-soldier-capture',
    'free-capture',
    'intercambios',
    [
      ...forts,
      { id: 'soldier', type: 'soldier', owner: 1, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'target', type: 'soldier', owner: 0, position: { q: 0, r: -1 }, facing: 3 },
    ],
    { kind: 'target-removed', targetId: 'target' },
    'tests/ai.test.ts: free capture',
    1,
  );
  add(
    'poisoned-fast-capture',
    'poisoned-capture',
    'capturas-envenenadas',
    [
      ...forts,
      { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
      { id: 'bait', type: 'soldier', owner: 0, position: { q: 0, r: -2 }, facing: 3 },
      { id: 'enemy-capturer', type: 'capturer', owner: 0, position: { q: 1, r: -2 } },
    ],
    { kind: 'safe-piece', pieceId: 'fast' },
    'tests/ai.test.ts: immediate recapture',
    1,
  );
  add(
    'aircraft-interception-en-route',
    'air-interception',
    'antiaereo',
    [
      ...forts,
      { id: 'plane', type: 'airplane', owner: 0, position: { q: 0, r: 0 }, facing: 2 },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 1, r: -1 } },
    ],
    { kind: 'preserve-piece', pieceId: 'plane' },
    'tests/ai-ranged.test.ts: interception en route',
  );
  add(
    'drone-interception-en-route',
    'drone-interception',
    'antiaereo',
    [
      ...forts,
      { id: 'drone', type: 'drone', owner: 0, position: { q: 0, r: 0 } },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 2, r: 0 } },
    ],
    { kind: 'preserve-piece', pieceId: 'drone' },
    'tests/engine.test.ts: drone interception',
  );
  add(
    'convert-soldier-preserve-heading',
    'soldier-conversion',
    'cambios-bando',
    [
      ...forts,
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: 0 } },
      { id: 'target', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 4 },
    ],
    { kind: 'target-converted', targetId: 'target' },
    'tests/engine.test.ts: conversion preserves orientation',
  );
  add(
    'convert-loaded-not-empty',
    'ammunition-conversion',
    'municion',
    [
      ...forts,
      { id: 'capturer', type: 'capturer', owner: 1, position: { q: 0, r: 0 } },
      { id: 'empty', type: 'long', owner: 0, position: { q: 1, r: -1 }, missilesRemaining: 0 },
      { id: 'loaded', type: 'long', owner: 0, position: { q: -1, r: 1 }, missilesRemaining: 2 },
    ],
    { kind: 'target-converted', targetId: 'loaded' },
    'tests/ai.test.ts: loaded launcher conversion preference',
    1,
  );
  add(
    'launcher-firing-deployment',
    'launcher-deployment',
    'vehiculos',
    [
      ...forts,
      { id: 'launcher', type: 'long', owner: 0, position: { q: -3, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 1, r: 0 }, facing: 3 },
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: -3 } },
    ],
    { kind: 'threat-target', pieceId: 'launcher', targetId: 'plane' },
    'tests/ai-ranged.test.ts: launcher firing ring',
  );
  add(
    'tank-escape-aircraft',
    'tank-escape',
    'vehiculos',
    [
      ...forts,
      { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 5 },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
      { id: 'bait', type: 'soldier', owner: 1, position: { q: -2, r: 0 }, facing: 5 },
    ],
    { kind: 'safe-piece', pieceId: 'tank' },
    'tests/ai-ranged.test.ts: tank escapes aircraft bait',
  );
  add(
    'tank-create-firing-line',
    'tank-orientation',
    'orientacion',
    [
      ...forts,
      { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 0 },
      { id: 'target', type: 'soldier', owner: 1, position: { q: 0, r: 2 }, facing: 0 },
    ],
    { kind: 'threat-or-remove', pieceId: 'tank', targetId: 'target' },
    'src/engine.ts: legal cannon orientation and firing',
  );
  add(
    'suppress-aircraft-single-layer',
    'two-layer-suppression',
    'intercambios',
    [
      ...forts,
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
      { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: 3 } },
    ],
    { kind: 'target-removed', targetId: 'plane' },
    'tests/ai-ranged.test.ts: aircraft versus ground target',
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../tests/fixtures/ai-strategic-positions.json', import.meta.url),
      'utf8',
    ),
  );
  for (const entry of fixture.cases) {
    const isFast = ['fast-expert-drone', 'fast-neural-tank', 'fast-neural-tank-second'].includes(
      entry.id,
    );
    if (!isFast && entry.id !== 'plane-expert-heading') continue;
    const type = isFast ? 'fast' : 'airplane';
    entries.push({
      id: `recorded-${entry.id}`,
      family: isFast ? 'recorded-poisoned' : 'recorded-aircraft-escape',
      category: isFast ? 'capturas-envenenadas' : 'orientacion',
      partition: isFast ? 'reserved' : 'development',
      source: `tests/fixtures/ai-strategic-positions.json#${entry.id}`,
      provenance: 'public-match-regression; may overlap historical training replays',
      state: entry.state,
      rules: entry.rules,
      objective: { kind: 'safe-type', type },
      objectiveStrength: 'tactical-proof',
    });
  }
  return entries;
}

function winner(state, player) {
  return state.outcome?.type === 'win' && state.outcome.winner === player;
}

/** Evaluate only scoped engine facts, not a supposedly unique optimal action. */
export function assessBenchmarkAction(engine, entry, action) {
  if (!action) return { legal: false, success: false, reason: 'No se devolvió una orden.' };
  const result = engine.applyAction(entry.state, action, entry.rules);
  if (!result.ok) return { legal: false, success: false, reason: result.error ?? 'Orden ilegal.' };
  const player = entry.state.activePlayer;
  const after = result.state;
  const goal = entry.objective;
  if (winner(after, 1 - player))
    return { legal: true, success: false, reason: 'La orden pierde la partida.' };
  let success = winner(after, player);
  if (!success) {
    const unit = after.pieces.find((piece) => piece.id === goal.pieceId && piece.owner === player);
    const target = after.pieces.find((piece) => piece.id === goal.targetId);
    const lostOnReply = (id) =>
      !after.outcome &&
      engine.getAllLegalActions(after).some((reply) => {
        const next = engine.applyAction(after, reply, entry.rules);
        return (
          next.ok && !next.state.pieces.some((piece) => piece.id === id && piece.owner === player)
        );
      });
    switch (goal.kind) {
      case 'win-now':
        break;
      case 'no-immediate-loss':
        success =
          after.outcome?.type === 'draw' ||
          (!after.outcome &&
            !engine
              .getAllLegalActions(after)
              .some((reply) =>
                winner(engine.applyAction(after, reply, entry.rules).state, 1 - player),
              ));
        break;
      case 'preserve-piece':
        success = Boolean(unit);
        break;
      case 'safe-piece':
        success = Boolean(unit) && !lostOnReply(goal.pieceId);
        break;
      case 'safe-type': {
        const original = entry.state.pieces.filter(
          (piece) => piece.owner === player && piece.type === goal.type,
        );
        success =
          original.length > 0 &&
          original.every(
            (piece) =>
              after.pieces.some((next) => next.id === piece.id && next.owner === player) &&
              !lostOnReply(piece.id),
          );
        break;
      }
      case 'target-removed':
        success = !target;
        break;
      case 'target-converted':
        success = target?.owner === player;
        break;
      case 'threat-target':
      case 'threat-or-remove':
        success =
          (goal.kind === 'threat-or-remove' && !target) ||
          (Boolean(unit) &&
            engine
              .getPreviewActionsForPiece(after, goal.pieceId)
              .some((next) => next.kind === 'shoot' && next.targetId === goal.targetId));
        break;
      default:
        throw new Error(`Objetivo desconocido: ${goal.kind}`);
    }
  }
  return {
    legal: true,
    success,
    reason: success
      ? 'Cumple el objetivo limitado del caso.'
      : 'No cumple el objetivo limitado del caso.',
  };
}

export function validateBenchmarkCases(engine, entries, { exhaustive = false } = {}) {
  const ids = new Set();
  const partitions = new Map();
  return entries.map((entry) => {
    if (!entry.id || ids.has(entry.id)) throw new Error(`ID duplicado o vacío: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.family || !entry.category || !['development', 'reserved'].includes(entry.partition))
      throw new Error(`Metadatos incompletos: ${entry.id}`);
    if (partitions.has(entry.family) && partitions.get(entry.family) !== entry.partition)
      throw new Error(`Familia dividida entre particiones: ${entry.family}`);
    partitions.set(entry.family, entry.partition);
    const issues = engine.validateState(entry.state);
    if (issues.length || entry.state.outcome)
      throw new Error(`Posición inválida ${entry.id}: ${issues.join('; ')}`);
    const legal = engine.getAllLegalActions(entry.state);
    let accepted = 0;
    let checked = 0;
    for (const action of legal) {
      checked += 1;
      if (assessBenchmarkAction(engine, entry, action).success) accepted += 1;
      if (!exhaustive && accepted > 0 && checked > accepted) break;
    }
    if (!accepted || accepted === checked)
      throw new Error(
        `El objetivo no discrimina órdenes legales: ${entry.id} (${accepted}/${checked})`,
      );
    return {
      id: entry.id,
      legalActions: legal.length,
      checkedActions: checked,
      acceptedActionsObserved: accepted,
      rejectedActionsObserved: checked - accepted,
      exhaustive: checked === legal.length,
    };
  });
}
