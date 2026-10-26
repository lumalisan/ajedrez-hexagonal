import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArguments, writeJsonCheckpoint } from './shared.mjs';

const BETS = [0.05, 0.1, 0.2, 0.4, 0.8, 1.2, 1.6, 1.9, 2];

/** Sum over all future trials is overallAlpha; indices must be unique in the caller's ledger. */
export function confirmationAlpha(trial, overallAlpha = 0.05) {
  if (!Number.isSafeInteger(trial) || trial < 1 || !(overallAlpha > 0 && overallAlpha < 1))
    throw new Error('Índice de confirmación o alfa global inválido.');
  return overallAlpha / trial / (trial + 1);
}
const logMeanExp = (values) => {
  const maximum = Math.max(...values);
  return maximum === -Infinity
    ? -Infinity
    : maximum +
        Math.log(values.reduce((sum, value) => sum + Math.exp(value - maximum), 0) / values.length);
};

/** A fixed mixture of nonnegative betting supermartingales under mean <= 1/2. */
export function pairedBettingEvidence(observations, alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Alfa inválido.');
  const positive = BETS.map(() => 0);
  const negative = BETS.map(() => 0);
  let maximumPositive = 0;
  let maximumNegative = 0;
  for (const observation of observations) {
    if (!(
      observation.lower >= 0 &&
      observation.upper <= 1 &&
      observation.lower <= observation.upper
    ))
      throw new Error('Puntos emparejados fuera del intervalo [0,1].');
    for (let index = 0; index < BETS.length; index += 1) {
      positive[index] += Math.log1p(BETS[index] * (observation.lower - 0.5));
      negative[index] += Math.log1p(BETS[index] * (0.5 - observation.upper));
    }
    maximumPositive = Math.max(maximumPositive, logMeanExp(positive));
    maximumNegative = Math.max(maximumNegative, logMeanExp(negative));
  }
  return {
    bets: BETS,
    logEvidenceImprovement: logMeanExp(positive),
    logEvidenceRegression: logMeanExp(negative),
    maximumLogEvidenceImprovement: maximumPositive,
    maximumLogEvidenceRegression: maximumNegative,
    logThreshold: Math.log(2 / alpha),
    alphaPerDirection: alpha / 2,
    improvement: maximumPositive >= Math.log(2 / alpha),
    regression: maximumNegative >= Math.log(2 / alpha),
    method:
      'Fixed uniform mixture of product(1+lambda*(pair-score-0.5)); Ville bound; alpha/2 per direction.',
    source: 'https://doi.org/10.1093/jrsssb/qkad009',
  };
}

/**
 * One observation is an opening pair, not a game. Unfinished games contribute
 * bounds [0, 1], never invented draws. The confidence sequence spends
 * alpha/(n*(n+1)) across looks, allowing inspection after each complete pair.
 * Assumes independently sampled pairs for one predeclared candidate/protocol.
 */
export function assessPairedArena(report, settings = {}) {
  const overallAlpha = settings.alpha ?? 0.05;
  const alpha =
    settings.trial === undefined ? overallAlpha : confirmationAlpha(settings.trial, overallAlpha);
  const minimumPairs = settings.minimumPairs ?? 100;
  const minimumCompletion = settings.minimumCompletion ?? 0.8;
  const method = settings.method ?? 'hoeffding';
  const fixedHorizon = settings.fixedHorizon ?? false;
  if (!['hoeffding', 'betting'].includes(method))
    throw new Error('Método estadístico desconocido.');
  if (typeof fixedHorizon !== 'boolean' || (fixedHorizon && method !== 'betting'))
    throw new Error('El horizonte final fijo requiere el método betting.');
  if (!(alpha > 0 && alpha < 1) || !Number.isSafeInteger(minimumPairs) || minimumPairs < 1)
    throw new Error('Confianza o mínimo de pares inválidos.');
  if (!(minimumCompletion > 0 && minimumCompletion <= 1))
    throw new Error('La finalización mínima debe estar entre 0 y 1.');
  const plannedPairs = report.settings?.pairs;
  if (!Number.isSafeInteger(plannedPairs) || plannedPairs < 1)
    throw new Error('El informe no declara cuántos pares estaban previstos.');
  const groups = new Map();
  for (const game of report.games ?? []) {
    if (
      !Number.isSafeInteger(game.pair) ||
      game.pair < 1 ||
      game.pair > plannedPairs ||
      ![0, 1].includes(game.neuralPlayer)
    )
      throw new Error('Identidad de pareja o bando inválida.');
    const group = groups.get(game.pair) ?? [];
    if (group.some((other) => other.neuralPlayer === game.neuralPlayer))
      throw new Error('Hay un bando duplicado dentro de una pareja.');
    group.push(game);
    groups.set(game.pair, group);
  }
  let pairedGames = 0;
  let completed = 0;
  let points = 0;
  const observations = [];
  for (const [pair, games] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    // Processing faster pairs first can bias a sequential test. Only use the fixed prefix.
    if (games.length !== 2 || pair !== observations.length + 1) break;
    let lower = 0;
    let upper = 0;
    pairedGames += 2;
    for (const game of games) {
      if (!game.outcome) {
        upper += 1;
        continue;
      }
      const outcome = game.outcome;
      if (outcome.type !== 'draw' && (outcome.type !== 'win' || ![0, 1].includes(outcome.winner)))
        throw new Error('Desenlace desconocido: solo se admiten resultados del motor.');
      const value = outcome.type === 'draw' ? 0.5 : Number(outcome.winner === game.neuralPlayer);
      completed += 1;
      points += value;
      lower += value;
      upper += value;
    }
    observations.push({ lower: lower / 2, upper: upper / 2 });
  }
  const pairs = observations.length;
  const mean = (key) => observations.reduce((sum, entry) => sum + entry[key], 0) / pairs;
  const radius = pairs
    ? Math.sqrt(Math.log((2 * pairs * (pairs + 1)) / alpha) / (2 * pairs))
    : null;
  const interval = pairs
    ? [Math.max(0, mean('lower') - radius), Math.min(1, mean('upper') + radius)]
    : [0, 1];
  const completion = pairedGames ? completed / pairedGames : 0;
  const sufficient =
    pairs >= minimumPairs &&
    completion >= minimumCompletion &&
    (!fixedHorizon || pairs === plannedPairs);
  const betting = pairedBettingEvidence(observations, alpha);
  const improvement =
    method === 'betting'
      ? fixedHorizon
        ? betting.logEvidenceImprovement >= betting.logThreshold
        : betting.improvement
      : interval[0] > 0.5;
  const regression =
    method === 'betting'
      ? fixedHorizon
        ? betting.logEvidenceRegression >= betting.logThreshold
        : betting.regression
      : interval[1] < 0.5;
  const decision = !sufficient
    ? 'insufficient-evidence'
    : improvement && regression
      ? 'conflicting-evidence'
      : improvement
        ? 'evidence-of-improvement'
        : regression
          ? 'evidence-of-regression'
          : 'inconclusive';
  return {
    format: 'hex-paired-assessment-v1',
    arenaStatus: report.status,
    plannedPairs,
    observedPairs: pairs,
    unpairedGames: [...groups.values()].filter((games) => games.length === 1).length,
    gamesOutsideCompletedPrefix: (report.games?.length ?? 0) - pairedGames,
    pairedGames,
    completed,
    inconclusive: pairedGames - completed,
    completion,
    observedScore: completed ? points / completed : null,
    scoreBounds: pairs ? [mean('lower'), mean('upper')] : [0, 1],
    confidenceSequence: interval,
    alpha,
    ...(settings.trial === undefined
      ? {}
      : {
          errorSpending: {
            trial: settings.trial,
            overallAlpha,
            allocatedAlpha: alpha,
            method: 'overallAlpha/(trial*(trial+1)); union bound across unique predeclared trials.',
            ledgerRequired:
              'Use a new unique trial index and fresh confirmation draws for every new candidate; this tool does not manage the ledger.',
          },
        }),
    minimumPairs,
    minimumCompletion,
    decisionMethod: method,
    stoppingRule: fixedHorizon
      ? 'fixed-final-look-at-all-planned-pairs'
      : 'anytime-completed-prefix',
    betting,
    method:
      method === 'betting'
        ? betting.method
        : 'Opening-pair Hoeffding confidence sequence; alpha spending alpha/(n*(n+1)).',
    assumptions:
      'Independent opening pairs; one candidate and protocol fixed before testing. Fresh draws prevent test reuse; repeated candidate trials also require error control across tests.',
    decision,
    promotionAllowed: false,
    note: 'Diagnóstico estadístico conservador. No publica pesos ni sustituye la evaluación a 15 s, las regresiones y la comprobación de navegador.',
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    input: { type: 'string', required: true },
    output: { type: 'string', required: true },
    alpha: { type: 'number', default: 0.05, min: 0.000001, max: 0.5 },
    'minimum-pairs': { type: 'number', default: 100, integer: true, min: 1 },
    'minimum-completion': { type: 'number', default: 0.8, min: 0.01, max: 1 },
    method: { type: 'string', default: 'hoeffding' },
    trial: { type: 'number', integer: true, min: 1 },
    'fixed-horizon': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(
      'Evalúa pares sin adjudicar inconclusas: --input arena.json --output assessment.json [--method betting --fixed-horizon] [--trial k --alpha 0.05]. Cada intento requiere un índice único en un registro externo y sorteos nuevos.',
    );
    return;
  }
  const report = JSON.parse(await readFile(resolve(options.input), 'utf8'));
  const result = assessPairedArena(report, {
    alpha: options.alpha,
    minimumPairs: options['minimum-pairs'],
    minimumCompletion: options['minimum-completion'],
    method: options.method,
    ...(options.trial === undefined ? {} : { trial: options.trial }),
    fixedHorizon: options['fixed-horizon'],
  });
  await writeJsonCheckpoint(options.output, result);
  console.log(`${result.decision}: ${result.observedPairs} pares; ${options.output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
