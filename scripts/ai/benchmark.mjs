import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveSeed,
  loadGameModules,
  parseArguments,
  readModelBytes,
  writeJsonCheckpoint,
} from './shared.mjs';
import {
  BENCHMARK_VERSION,
  assessBenchmarkAction,
  createBenchmarkCases,
  validateBenchmarkCases,
} from './benchmark-cases.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceFiles = [
  'src/ai.ts',
  'src/ai-neural.ts',
  'src/ai-ranged.ts',
  'src/ai-material.ts',
  'src/ai-airplane.ts',
  'src/ai-position.ts',
  'src/engine.ts',
  'src/hex.ts',
  'src/types.ts',
  'src/classic-rules.ts',
  'src/setup.ts',
  'src/action-identity.ts',
  'scripts/ai/benchmark.mjs',
  'scripts/ai/benchmark-cases.mjs',
  'scripts/ai/shared.mjs',
  'tests/fixtures/ai-strategic-positions.json',
];

async function hashSources() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
    ),
  );
}

export function summarizeBenchmarkRows(rows) {
  const summarize = (group) => {
    const measured = group.filter((row) => !row.error);
    const sum = (key) => measured.reduce((value, row) => value + (row[key] ?? 0), 0);
    const families = [...new Set(group.map((row) => row.family))];
    const perFamily = families
      .map((family) => {
        const members = measured.filter((row) => row.family === family);
        return members.length ? members.filter((row) => row.success).length / members.length : null;
      })
      .filter((value) => value !== null);
    const elapsedMs = sum('elapsedMs');
    return {
      cases: group.length,
      measured: measured.length,
      errors: group.filter((row) => row.error).length,
      legal: measured.filter((row) => row.legal).length,
      successes: measured.filter((row) => row.success).length,
      failures: measured.filter((row) => !row.success).length,
      accuracy: measured.length
        ? measured.filter((row) => row.success).length / measured.length
        : null,
      families: families.length,
      familyMeanAccuracy: perFamily.length
        ? perFamily.reduce((total, value) => total + value, 0) / perFamily.length
        : null,
      depthZero: measured.filter((row) => row.completedDepth === 0).length,
      averageCompletedDepth: measured.length ? sum('completedDepth') / measured.length : null,
      nodes: sum('nodes'),
      elapsedMs,
      nodesPerSecond: elapsedMs ? (sum('nodes') * 1000) / elapsedMs : null,
      averageElapsedMs: measured.length ? elapsedMs / measured.length : null,
    };
  };
  return Object.fromEntries(
    [...new Set(rows.map((row) => row.evaluator))].map((evaluator) => {
      const selected = rows.filter((row) => row.evaluator === evaluator);
      const by = (key) =>
        Object.fromEntries(
          [...new Set(selected.map((row) => row[key]))].map((value) => [
            value,
            summarize(selected.filter((row) => row[key] === value)),
          ]),
        );
      return [
        evaluator,
        {
          ...summarize(selected),
          byCategory: by('category'),
          byFamily: by('family'),
          verified: summarize(selected.filter((row) => row.objectiveStrength === 'tactical-proof')),
          preferences: summarize(
            selected.filter((row) => row.objectiveStrength === 'strategic-preference'),
          ),
        },
      ];
    }),
  );
}

/** Small paired search experiment. It never changes weights, rules or promotion state. */
export async function runBenchmark(options = {}) {
  const settings = {
    budgetMs: options.budgetMs ?? 250,
    depth: options.depth ?? 3,
    seed: options.seed ?? 20261023,
    partition: options.partition ?? 'development',
    limit: options.limit ?? null,
    searchProfile: 'pvs-threats',
    rangedPlay: true,
    difficulty: 'expert',
  };
  if (!['development', 'reserved', 'all'].includes(settings.partition))
    throw new Error('Partición inválida.');
  if (
    !Number.isInteger(settings.budgetMs) ||
    settings.budgetMs < 20 ||
    !Number.isInteger(settings.depth) ||
    settings.depth < 1 ||
    settings.depth > 12 ||
    !Number.isSafeInteger(settings.seed) ||
    settings.seed < 0 ||
    settings.seed > 0xffffffff ||
    (settings.limit !== null && (!Number.isInteger(settings.limit) || settings.limit < 1))
  )
    throw new Error('Presupuesto, profundidad, semilla o límite inválido.');
  const modules = await loadGameModules();
  const report = {
    format: 'hex-ai-search-benchmark-v1',
    status: 'incomplete',
    createdAt: new Date().toISOString(),
    settings,
    settingsSha256: digest(JSON.stringify(settings)),
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    scope:
      'Scoped public engine regressions and full-search timing; no Elo, mobile benchmark or proof of playing strength.',
    reservationNotice:
      settings.partition === 'development'
        ? null
        : 'Public reserved families: use once after manual selection, then retire this reservation. They are not an unseen independent holdout.',
    published: false,
    rows: [],
    summary: {},
  };
  const checkpoint = async () => {
    if (options.output) await writeJsonCheckpoint(options.output, report);
  };
  try {
    report.sourceHashes = await hashSources();
    const allCases = options.cases
      ? JSON.parse(await readFile(resolve(options.cases), 'utf8')).cases
      : createBenchmarkCases(modules.engine);
    if (!Array.isArray(allCases) || !allCases.length)
      throw new Error('El banco no contiene casos.');
    const validation = validateBenchmarkCases(modules.engine, allCases);
    const partitionCases = allCases.filter(
      (entry) => settings.partition === 'all' || entry.partition === settings.partition,
    );
    const selected = settings.limit ? partitionCases.slice(0, settings.limit) : partitionCases;
    if (!selected.length) throw new Error('La selección no contiene casos.');
    report.bank = {
      version: BENCHMARK_VERSION,
      path: options.cases ? resolve(options.cases) : 'scripts/ai/benchmark-cases.mjs',
      sha256: digest(JSON.stringify(allCases)),
      selectedSha256: digest(JSON.stringify(selected)),
      totalCases: allCases.length,
      totalFamilies: new Set(allCases.map((entry) => entry.family)).size,
      partitionCases: partitionCases.length,
      selectedCases: selected.length,
      selectedFamilies: new Set(selected.map((entry) => entry.family)).size,
      limited: selected.length < partitionCases.length,
      completePartitionCoverage: selected.length === partitionCases.length,
      cases: selected.map((entry) => ({
        id: entry.id,
        family: entry.family,
        category: entry.category,
        partition: entry.partition,
        objective: entry.objective,
        objectiveStrength: entry.objectiveStrength,
        source: entry.source,
        provenance: entry.provenance,
        rules: entry.rules,
        validation: validation.find((value) => value.id === entry.id),
      })),
    };
    const championPath = resolve(options.champion ?? resolve(root, 'src/ai-models/hex-value.bin'));
    const championBytes = await readModelBytes(championPath);
    const championHash = digest(new Uint8Array(championBytes));
    const variants = [
      { id: 'classic-ablation', evaluate: undefined, model: null },
      {
        id: 'champion',
        evaluate: modules.neural.createNeuralEvaluator(championBytes),
        model: { path: championPath, sha256: championHash },
      },
    ];
    if (options.model) {
      const bytes = await readModelBytes(options.model);
      const sha256 = digest(new Uint8Array(bytes));
      if (sha256 !== championHash)
        variants.push({
          id: 'candidate',
          evaluate: modules.neural.createNeuralEvaluator(bytes),
          model: { path: resolve(options.model), sha256 },
        });
      else report.candidateSkipped = 'Candidate and champion have identical SHA-256.';
    }
    report.evaluators = variants.map(({ id, model }) => ({ id, model }));
    report.plannedMeasurements = selected.length * variants.length;
    await checkpoint();
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      // Interleave evaluators and rotate their order to reduce consistent first-run bias.
      const order = [
        ...variants.slice(index % variants.length),
        ...variants.slice(0, index % variants.length),
      ];
      for (const variant of order) {
        const row = {
          id: entry.id,
          family: entry.family,
          category: entry.category,
          partition: entry.partition,
          objectiveStrength: entry.objectiveStrength,
          evaluator: variant.id,
          seed: deriveSeed(settings.seed, allCases.indexOf(entry)),
        };
        try {
          const before = JSON.stringify(entry.state);
          const result = modules.ai.searchMachineActionWithMetadata(entry.state, {
            depth: settings.depth,
            budgetMs: settings.budgetMs,
            seed: row.seed,
            difficulty: settings.difficulty,
            searchProfile: settings.searchProfile,
            rangedPlay: settings.rangedPlay,
            resolutionRules: entry.rules,
            ...(variant.evaluate ? { evaluate: variant.evaluate } : {}),
          });
          if (JSON.stringify(entry.state) !== before)
            throw new Error('La búsqueda modificó la posición de entrada.');
          Object.assign(
            row,
            result.metadata,
            { action: result.action },
            assessBenchmarkAction(modules.engine, entry, result.action),
          );
        } catch (error) {
          row.error = String(error);
        }
        report.rows.push(row);
        report.summary = summarizeBenchmarkRows(report.rows);
        await checkpoint();
      }
    }
    const afterSources = await hashSources();
    report.changedSources = Object.keys(report.sourceHashes).filter(
      (path) => report.sourceHashes[path] !== afterSources[path],
    );
    report.status =
      report.rows.some((row) => row.error) || report.changedSources.length
        ? 'incomplete'
        : 'complete';
    report.finishedAt = new Date().toISOString();
    await checkpoint();
    return report;
  } catch (error) {
    report.error = String(error);
    report.finishedAt = new Date().toISOString();
    await checkpoint();
    throw error;
  } finally {
    await modules.close();
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2), {
    help: { type: 'boolean', default: false },
    output: { type: 'string', required: true },
    model: { type: 'string' },
    champion: { type: 'string' },
    cases: { type: 'string' },
    partition: { type: 'string', default: 'development' },
    'budget-ms': { type: 'number', default: 250, integer: true, min: 20, max: 120000 },
    depth: { type: 'number', default: 3, integer: true, min: 1, max: 12 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 0xffffffff },
    limit: { type: 'number', integer: true, min: 1 },
  });
  if (args.help) {
    console.log(
      'pnpm exec node scripts/ai/benchmark.mjs --output .ai-lab/benchmark.json [--model candidate.bin] [--champion frozen.bin] [--budget-ms 250] [--depth 3] [--seed 20261023] [--limit 4] [--partition development|reserved|all] [--cases banco.json]',
    );
    return;
  }
  const report = await runBenchmark({ ...args, budgetMs: args['budget-ms'] });
  console.log(
    `Benchmark ${report.status}: ${report.rows.length}/${report.plannedMeasurements} búsquedas; ${report.bank.selectedCases} casos, ${report.bank.selectedFamilies} familias. Informe: ${resolve(args.output)}`,
  );
  if (report.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
