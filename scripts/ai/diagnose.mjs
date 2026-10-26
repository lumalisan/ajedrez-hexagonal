import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBenchmarkCases, assessBenchmarkAction } from './benchmark-cases.mjs';
import { deriveSeed, parseArguments, readModelBytes, writeJsonCheckpoint } from './shared.mjs';
import { researchFingerprint } from './research-state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Expose the actual private selector in memory; never copy its heuristics or edit production. */
export async function loadDiagnosticModules() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [
      {
        name: 'read-only-ai-diagnosis',
        enforce: 'pre',
        transform(code, id) {
          if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/src/ai.ts')) return null;
          return `${code}\nexport { actionKey as diagnosticActionKey };\nexport function diagnosticSelect(state, cap, rangedPlay) { return selectSearchActions(state, getAllLegalActions(state), [], 'balanced', cap, undefined, rangedPlay); }\n`;
        },
      },
    ],
  });
  try {
    const [ai, engine, neural, ranged] = await Promise.all([
      server.ssrLoadModule('/src/ai.ts'),
      server.ssrLoadModule('/src/engine.ts'),
      server.ssrLoadModule('/src/ai-neural.ts'),
      server.ssrLoadModule('/src/ai-ranged.ts'),
    ]);
    return { ai, engine, neural, ranged, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

/** A firing threat is a scoped goal; this does not establish a forced capture. */
export function auditThreatPreference(engine, entry) {
  if (!['threat-target', 'threat-or-remove'].includes(entry.objective.kind)) return null;
  const goal = entry.objective;
  return engine
    .getAllLegalActions(entry.state)
    .filter((action) => assessBenchmarkAction(engine, entry, action).success)
    .map((action) => {
      const after = engine.applyAction(entry.state, action, entry.rules).state;
      const replies = engine.getAllLegalActions(after);
      const evasions = replies.filter((reply) => {
        const next = engine.applyAction(after, reply, entry.rules).state;
        const target = next.pieces.find((piece) => piece.id === goal.targetId);
        return (
          target?.owner !== entry.state.activePlayer &&
          Boolean(target) &&
          !engine
            .getPreviewActionsForPiece(next, goal.pieceId)
            .some((attack) => attack.kind === 'shoot' && attack.targetId === goal.targetId)
        );
      });
      return {
        action,
        legalReplies: replies.length,
        repliesAvoidingTheShot: evasions.length,
        exampleEvasion: evasions[0] ?? null,
        interpretation:
          'Existence of an evasion refutes a forced immediate follow-up shot, not the strategic value of the threat.',
      };
    });
}

export function selectionProbe(ai, engine, entry, teacherAction, cap = 28) {
  const selected = ai.diagnosticSelect(entry.state, cap, true);
  const keys = new Set(selected.map(ai.diagnosticActionKey));
  const legal = engine.getAllLegalActions(entry.state);
  return {
    kind: 'stateless-interior-selector-applied-at-this-position',
    actualSearchTrace: false,
    context:
      'No transposition/killer/history hints or in-check bypass; root depth one actually examines every legal action.',
    nominalCap: cap,
    legalActions: legal.length,
    retainedActions: selected.length,
    teacherActionRetained: teacherAction ? keys.has(ai.diagnosticActionKey(teacherAction)) : null,
  };
}

/** Counters change timings; these runs are diagnostic and cannot replace benchmark/arena. */
export async function diagnose(options = {}) {
  const settings = {
    budgetMs: options.budgetMs ?? 500,
    depth: options.depth ?? 5,
    teacherBudgetMs: options.teacherBudgetMs ?? 3000,
    teacherDepth: options.teacherDepth ?? 8,
    seed: options.seed ?? 20261023,
    limit: options.limit ?? null,
    caseId: options.caseId ?? null,
    topK: options.topK ?? 28,
    microIterations: options.microIterations ?? 1000,
  };
  const modules = await loadDiagnosticModules();
  const report = {
    format: 'hex-ai-diagnosis-v1',
    status: 'incomplete',
    createdAt: new Date().toISOString(),
    settings,
    interpretation:
      'Search/evaluator/selector diagnostics on public cases; no model selection, promotion or strength claim.',
    rows: [],
    published: false,
  };
  const checkpoint = async () => {
    if (options.output) await writeJsonCheckpoint(options.output, report);
  };
  try {
    report.sources = await researchFingerprint(root);
    const all = createBenchmarkCases(modules.engine);
    let selected = settings.caseId ? all.filter((entry) => entry.id === settings.caseId) : all;
    if (settings.limit) selected = selected.slice(0, settings.limit);
    if (!selected.length) throw new Error('No hay casos seleccionados.');
    report.bankSha256 = digest(JSON.stringify(all));
    report.bankCases = selected.map(
      ({ id, family, category, objectiveStrength, objective, source }) => ({
        id,
        family,
        category,
        objectiveStrength,
        objective,
        source,
      }),
    );
    const variants = [
      { id: 'classic-ablation', evaluate: modules.ai.evaluateClassicState, bytes: null },
    ];
    const championPath = options.champion ?? resolve(root, 'src/ai-models/hex-value.bin');
    const champion = await readModelBytes(championPath);
    variants.push({
      id: 'champion',
      evaluate: modules.neural.createNeuralEvaluator(champion),
      bytes: champion,
    });
    if (options.model) {
      const candidate = await readModelBytes(options.model);
      if (digest(new Uint8Array(candidate)) !== digest(new Uint8Array(champion)))
        variants.push({
          id: 'candidate',
          evaluate: modules.neural.createNeuralEvaluator(candidate),
          bytes: candidate,
        });
    }
    report.evaluators = variants.map(({ id, bytes }) => ({
      id,
      sha256: bytes ? digest(new Uint8Array(bytes)) : null,
    }));
    await checkpoint();
    for (const entry of selected) {
      const seed = deriveSeed(settings.seed, all.indexOf(entry));
      const searchOptions = {
        searchProfile: 'pvs-threats',
        rangedPlay: true,
        difficulty: 'expert',
        resolutionRules: entry.rules,
        seed,
      };
      const teacher = modules.ai.searchMachineActionWithMetadata(entry.state, {
        ...searchOptions,
        budgetMs: settings.teacherBudgetMs,
        depth: settings.teacherDepth,
      });
      const row = {
        id: entry.id,
        family: entry.family,
        objectiveStrength: entry.objectiveStrength,
        teacher: {
          ...teacher,
          assessment: assessBenchmarkAction(modules.engine, entry, teacher.action),
          evaluator: 'classic-ablation',
        },
        selection: selectionProbe(modules.ai, modules.engine, entry, teacher.action, settings.topK),
        threatPreference: auditThreatPreference(modules.engine, entry),
        measurements: [],
      };
      for (const variant of variants) {
        let calls = 0;
        let evaluatorMs = 0;
        const evaluate = (state, player, rules) => {
          const started = performance.now();
          // Classic's third parameter is personality, not the resolution rules.
          const value =
            variant.id === 'classic-ablation'
              ? variant.evaluate(state, player)
              : variant.evaluate(state, player, rules);
          evaluatorMs += performance.now() - started;
          calls += 1;
          return value;
        };
        evaluate.includesRangedValue = variant.evaluate.includesRangedValue;
        const before = JSON.stringify(entry.state);
        const result = modules.ai.searchMachineActionWithMetadata(entry.state, {
          ...searchOptions,
          budgetMs: settings.budgetMs,
          depth: settings.depth,
          evaluate,
        });
        if (JSON.stringify(entry.state) !== before)
          throw new Error('La búsqueda modificó la entrada.');
        const started = performance.now();
        let checksum = 0;
        for (let iteration = 0; iteration < settings.microIterations; iteration += 1) {
          checksum +=
            variant.id === 'classic-ablation'
              ? variant.evaluate(entry.state, entry.state.activePlayer)
              : variant.evaluate(entry.state, entry.state.activePlayer, entry.rules);
        }
        const microMs = performance.now() - started;
        row.measurements.push({
          evaluator: variant.id,
          ...result,
          assessment: assessBenchmarkAction(modules.engine, entry, result.action),
          sameActionAsTeacher: Boolean(
            result.action &&
            teacher.action &&
            modules.ai.diagnosticActionKey(result.action) ===
              modules.ai.diagnosticActionKey(teacher.action),
          ),
          calls,
          evaluatorMs,
          approximateEvaluatorShare: result.metadata.elapsedMs
            ? evaluatorMs / result.metadata.elapsedMs
            : null,
          timingScope:
            'Includes diagnostic timer overhead; excludes ranged supplement, engine and selection from evaluatorMs. Do not compare as an uninstrumented benchmark.',
          micro: {
            iterations: settings.microIterations,
            elapsedMs: microMs,
            averageMs: microMs / settings.microIterations,
            checksum,
            scope:
              'Repeated CPU evaluation on this position; not mobile or full-search throughput.',
          },
        });
      }
      report.rows.push(row);
      await checkpoint();
    }
    report.sourcesUnchanged = report.sources === (await researchFingerprint(root));
    report.status = report.sourcesUnchanged ? 'complete' : 'incomplete';
    report.finishedAt = new Date().toISOString();
    await checkpoint();
    return report;
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
    'case-id': { type: 'string' },
    limit: { type: 'number', integer: true, min: 1 },
    'budget-ms': { type: 'number', default: 500, integer: true, min: 20, max: 120000 },
    depth: { type: 'number', default: 5, integer: true, min: 1, max: 12 },
    'teacher-budget-ms': { type: 'number', default: 3000, integer: true, min: 20, max: 120000 },
    'teacher-depth': { type: 'number', default: 8, integer: true, min: 1, max: 12 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 0xffffffff },
    'top-k': { type: 'number', default: 28, integer: true, min: 1 },
    'micro-iterations': { type: 'number', default: 1000, integer: true, min: 1 },
  });
  if (args.help) {
    console.log(
      'pnpm exec node scripts/ai/diagnose.mjs --output .ai-lab/diagnosis.json [--case-id tank-create-firing-line] [--model candidate.bin] [--champion frozen.bin] [--budget-ms 500] [--depth 5] [--teacher-budget-ms 3000] [--teacher-depth 8] [--top-k 28] [--limit 2]',
    );
    return;
  }
  const report = await diagnose({
    ...args,
    budgetMs: args['budget-ms'],
    teacherBudgetMs: args['teacher-budget-ms'],
    teacherDepth: args['teacher-depth'],
    topK: args['top-k'],
    caseId: args['case-id'],
    microIterations: args['micro-iterations'],
  });
  console.log(
    `Diagnóstico ${report.status}: ${report.rows.length} posiciones. Informe: ${resolve(args.output)}`,
  );
  if (report.status !== 'complete') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
