import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameModules, parseArguments, writeJsonCheckpoint } from './shared.mjs';

export const ENDGAME_BOOK_VERSION = 'hex-engine-endgames-v1';
const rules = { repetition: null, noProgressPlyLimit: null, orientationOnlyTurnLimit: 5 };

/** New positions constructed before observing any model's choices. No rotated duplicates. */
export function createEndgameCases(engine) {
  const ownFort = { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 };
  const remoteDefender = {
    id: 'remote-defender',
    type: 'soldier',
    owner: 1,
    position: { q: -4, r: 4 },
    facing: 0,
  };
  const rim = [
    { id: 'rim-shield-a', type: 'antiAir', owner: 0, position: { q: 4, r: 0 } },
    { id: 'rim-shield-b', type: 'antiAir', owner: 0, position: { q: 4, r: 1 } },
  ];
  const entries = [];
  const add = (id, seed, pieces, maxPlies, note) =>
    entries.push({
      id,
      family: id,
      seed,
      partition: 'reserved',
      expectedWinner: 0,
      proofHorizonPlies: maxPlies,
      maximumWinningPlayerOrders: Math.ceil(maxPlies / 2),
      source: 'engine-constructed before any model evaluation',
      provenance:
        'One position and seed per constructed family; not selected using candidate choices. Public construction is not an independent estimate of general playing strength.',
      note,
      state: engine.createGameState(pieces),
      rules: { ...rules },
    });
  add(
    'contact-two-hit-corridor',
    230101,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: -2 }, hp: 2 },
      { id: 'infantry', type: 'soldier', owner: 0, position: { q: 5, r: -1 }, facing: 0 },
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 4, r: -1 } },
      { id: 'support-shield', type: 'antiAir', owner: 0, position: { q: 4, r: 0 } },
      remoteDefender,
    ],
    3,
    'Two different contact attackers against a two-HP Fortress at the board rim.',
  );
  add(
    'missile-two-hit-rim',
    230211,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: -3 }, hp: 2 },
      { id: 'launcher', type: 'long', owner: 0, position: { q: 5, r: 0 }, missilesRemaining: 2 },
      ...rim,
      remoteDefender,
    ],
    3,
    'Two missiles, three-hex range and a narrow protected deployment.',
  );
  add(
    'tank-two-hit-rim',
    230307,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: -2 }, hp: 2 },
      { id: 'tank', type: 'medium', owner: 0, position: { q: 5, r: 0 }, cannon: 0 },
      ...rim,
      remoteDefender,
    ],
    3,
    'Reusable cannon, two-hex range and a two-HP terminal objective.',
  );
  add(
    'tank-three-hit-rim',
    230401,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: -2 }, hp: 3 },
      { id: 'tank', type: 'medium', owner: 0, position: { q: 5, r: 0 }, cannon: 0 },
      ...rim,
      remoteDefender,
    ],
    5,
    'Three legal cannon hits; retains the opponent replies and all cannon/transform alternatives.',
  );
  add(
    'reorientation-or-transformation',
    230503,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: -2 }, hp: 1 },
      { id: 'tank', type: 'medium', owner: 0, position: { q: 5, r: 0 }, cannon: 3 },
      ...rim,
      remoteDefender,
    ],
    3,
    'Initially misaligned cannon. Accepts every engine-proven winning reorientation or transformation.',
  );
  add(
    'shield-transfer-air-ground',
    230601,
    [
      ownFort,
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 1, r: 0 }, hp: 1 },
      { id: 'plane', type: 'airplane', owner: 0, position: { q: -1, r: 0 }, facing: 2 },
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: -1 } },
      { id: 'enemy-shield', type: 'antiAir', owner: 1, position: { q: 1, r: -1 } },
      remoteDefender,
    ],
    3,
    'Enemy air protection, legal shield conversion and alternative ground approach. The aircraft starts outside interception range.',
  );
  return entries.map((entry) =>
    entry.id.startsWith('tank-') || entry.id === 'reorientation-or-transformation'
      ? { ...entry, family: 'rim-cannon', seed: 230307 }
      : entry,
  );
}

/** Exhaustive finite-horizon minimax over legal engine successors, without a static evaluator. */
export function proveEndgame(engine, entry, { maxNodes = 100000 } = {}) {
  if (engine.validateState(entry.state).length || entry.state.outcome)
    throw new Error(`Estado inválido: ${entry.id}`);
  if (
    ![0, 1].includes(entry.expectedWinner) ||
    !Number.isSafeInteger(entry.proofHorizonPlies) ||
    entry.proofHorizonPlies < 1 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1
  )
    throw new Error('Contrato de prueba inválido.');
  let nodes = 0;
  let applications = 0;
  const memo = new Map();
  const winner = entry.expectedWinner;
  const won = (state) => state.outcome?.type === 'win' && state.outcome.winner === winner;
  const successors = (state) =>
    engine
      .getAllLegalActions(state)
      .map((action) => {
        const result = engine.applyAction(state, action, entry.rules);
        applications += 1;
        if (!result.ok) throw new Error('Una orden del motor no se pudo resolver.');
        return {
          action,
          state: result.state,
          priority: won(result.state)
            ? 2
            : result.events.some((event) => event.type === 'fortressDamage')
              ? 1
              : 0,
        };
      })
      .sort((left, right) => right.priority - left.priority);
  const key = (state, remaining) => {
    const domain = { ...state };
    delete domain.history;
    // These histories cannot affect terminal rules when their limit is null.
    if (entry.rules.repetition === null) delete domain.positionCounts;
    if (entry.rules.noProgressPlyLimit === null) delete domain.noProgressPlyCount;
    domain.pieces = [...state.pieces].sort((left, right) => left.id.localeCompare(right.id));
    return `${remaining}:${JSON.stringify(domain)}`;
  };
  const visit = (state, remaining) => {
    nodes += 1;
    if (nodes > maxNodes) throw new Error('proof-budget-exhausted');
    if (state.outcome) return won(state);
    if (!remaining) return false;
    const identity = key(state, remaining);
    if (memo.has(identity)) return memo.get(identity);
    const next = successors(state);
    // Engine normally resolves passes automatically. Never invent a pass or draw here.
    if (!next.length) return false;
    const result =
      state.activePlayer === winner
        ? next.some((child) => visit(child.state, remaining - 1))
        : next.every((child) => visit(child.state, remaining - 1));
    memo.set(identity, result);
    return result;
  };
  try {
    const rootChildren = successors(entry.state);
    const solved = rootChildren.map((child) => ({
      action: child.action,
      forcedWin: visit(child.state, entry.proofHorizonPlies - 1),
    }));
    const winningActions = solved.filter((child) => child.forcedWin).map((child) => child.action);
    const forcedWin =
      entry.state.activePlayer === winner
        ? winningActions.length > 0
        : solved.length > 0 && winningActions.length === solved.length;
    const immediateWins = rootChildren
      .filter((child) => won(child.state))
      .map((child) => child.action);
    return {
      status: 'complete',
      forcedWin,
      winningActions,
      immediateWins,
      legalActions: solved.length,
      nodes,
      engineApplications: applications,
      memoEntries: memo.size,
      horizonPlies: entry.proofHorizonPlies,
      interpretation:
        'Exact finite-horizon engine result, conditional on these initial pieces, rules and side to move. No claim beyond the horizon.',
    };
  } catch (error) {
    if (error.message !== 'proof-budget-exhausted') throw error;
    return {
      status: 'incomplete',
      forcedWin: null,
      winningActions: null,
      nodes,
      engineApplications: applications,
      memoEntries: memo.size,
      horizonPlies: entry.proofHorizonPlies,
      reason: 'proof-budget-exhausted',
    };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    output: { type: 'string', required: true },
    family: { type: 'string' },
    'max-nodes': { type: 'number', default: 100000, integer: true, min: 1, max: 1000000 },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/endgame-cases.mjs --output .ai-lab/endgame-book.json [--family id] [--max-nodes 100000]',
    );
    return;
  }
  const modules = await loadGameModules();
  try {
    const all = createEndgameCases(modules.engine);
    const selected = options.family ? all.filter((entry) => entry.family === options.family) : all;
    if (!selected.length) throw new Error('Familia desconocida.');
    const report = {
      format: ENDGAME_BOOK_VERSION,
      createdAt: new Date().toISOString(),
      status: 'incomplete',
      selection:
        'Constructed before model evaluation; all families emitted, no model-based filtering.',
      sha256: createHash('sha256').update(JSON.stringify(all)).digest('hex'),
      totalFamilies: new Set(all.map((entry) => entry.family)).size,
      selectedFamilies: new Set(selected.map((entry) => entry.family)).size,
      cases: [],
    };
    for (const entry of selected) {
      report.cases.push({
        ...entry,
        proof: proveEndgame(modules.engine, entry, { maxNodes: options['max-nodes'] }),
        shorterHorizonProof: proveEndgame(
          modules.engine,
          {
            ...entry,
            proofHorizonPlies: entry.proofHorizonPlies - 2,
          },
          { maxNodes: options['max-nodes'] },
        ),
      });
      await writeJsonCheckpoint(options.output, report);
    }
    report.status = report.cases.every(
      (entry) =>
        entry.proof.status === 'complete' &&
        entry.proof.forcedWin &&
        entry.shorterHorizonProof.status === 'complete' &&
        !entry.shorterHorizonProof.forcedWin,
    )
      ? 'complete'
      : 'incomplete';
    await writeJsonCheckpoint(options.output, report);
    console.log(
      `Libro ${report.status}: ${report.cases.length} posiciones, ${report.selectedFamilies} familias. Informe: ${resolve(options.output)}`,
    );
    if (report.status !== 'complete') process.exitCode = 1;
  } finally {
    await modules.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
