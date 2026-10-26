import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as engine from '../src/engine';
import * as neural from '../src/ai-neural';
import * as ranged from '../src/ai-ranged';
import * as ai from '../src/ai';
import { reanalysisOptions, runReanalysis } from '../scripts/ai/reanalyze.mjs';
import {
  parseResearchInput,
  positionFingerprint,
  reconstructResearchGame,
  selectPositionIndices,
} from '../scripts/ai/research-data.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const modules = { engine, neural, ranged, ai };
const rules = { ...engine.DEFAULT_ACTION_RESOLUTION_RULES };

function trajectory(count = 12) {
  const initialState = engine.createInitialState();
  const actions = [];
  let state = initialState;
  for (let index = 0; index < count && !state.outcome; index += 1) {
    const action =
      engine.getAllLegalActions(state)[index % engine.getAllLegalActions(state).length];
    actions.push(action);
    state = engine.applyAction(state, action, rules).state;
  }
  return { gameId: 'original-game', initialState, actions, rules };
}

function dataset(games) {
  return [
    { kind: 'metadata', format: 'hexagonal-neural-dataset', version: 1, rules },
    ...games.map((game) => ({ kind: 'game', ...game })),
  ]
    .map(JSON.stringify)
    .join('\n');
}

async function fixture(games = [trajectory()]) {
  const path = await mkdtemp(join(tmpdir(), 'hex-reanalysis-'));
  directories.push(path);
  const input = join(path, 'input.jsonl');
  const output = join(path, 'teacher.jsonl');
  await writeFile(input, dataset(games));
  const options = reanalysisOptions([
    '--input',
    input,
    '--output',
    output,
    '--positions',
    '3',
    '--positions-per-game',
    '3',
    '--min-gap',
    '2',
    '--budget-ms',
    '20',
    '--depth',
    '3',
    '--minimum-depth',
    '2',
    '--seed',
    '17',
  ]);
  return { input, output, options };
}

function teacher(position, options) {
  return {
    action: engine.getAllLegalActions(position)[0],
    metadata: {
      requestedDepth: options.depth,
      completedDepth: 3,
      nodes: 1,
      elapsedMs: 1,
      timedOut: false,
      score: 150,
      candidatesConsidered: 1,
    },
  };
}

describe('independent research data', () => {
  it('records a frozen neural search teacher and material/V2 targets, including model identity on resume', async () => {
    const { input, output, options } = await fixture([
      { ...trajectory(), familyId: 'fixed-family' },
    ]);
    const lines = (await readFile(input, 'utf8')).split('\n').map(JSON.parse);
    lines[0].sourceRole = 'development';
    await writeFile(input, lines.map(JSON.stringify).join('\n'));
    const modelPath = join(input, '..', 'teacher.bin');
    const modelBytes = await readFile(new URL('../src/ai-models/hex-value.bin', import.meta.url));
    await writeFile(modelPath, modelBytes);
    const originalValue = neural.createNeuralEvaluator(
      modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength),
    );
    const search = vi.fn((position, config) => {
      expect(typeof config.evaluate).toBe('function');
      expect(config.evaluate(position, 0, rules)).toBe(originalValue(position, 0, rules));
      return teacher(position, config);
    });
    const config = { ...options, target: 'material-residual-v1', 'teacher-model': modelPath };
    const dependencies = { modules, search, sourceHashes: { fixed: 'source' } };
    const partial = await runReanalysis({ ...config, 'max-search-ms': 20 }, dependencies);
    expect(partial.cursor).toBe(1);
    const rows = (await readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
    expect(rows[0]).toMatchObject({
      target: 'material-residual-v1',
      schema: 'hex-sparse-v2',
      inputSize: 5203,
      residualBaseline: 'material-fortress-v1',
      residualScale: 2000,
      includesRangedValue: true,
      teacher: { evaluator: 'frozen-neural-model', neural: true, model: { path: modelPath } },
    });
    expect(rows[0].teacher.model.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const sample of partial.samples) {
      expect(sample.familyId).toBe('fixed-family');
      expect(sample.baseline).toBe(
        neural.evaluateNeuralMaterialBaseline(
          reconstructResearchGame(
            parseResearchInput(await readFile(input, 'utf8'))[0],
            modules,
          ).positions.find((p) => p.ply === sample.ply),
          sample.perspective,
        ),
      );
      expect(sample.teacher).toBeCloseTo(
        Math.max(-1, Math.min(1, (sample.teacherScore - sample.baseline) / 2000)),
        12,
      );
      expect(sample.outcome).toBeNull();
      expect(sample.features.some((index) => index >= 5183)).toBe(true);
    }
    const changed = Buffer.from(modelBytes);
    changed[changed.length - 1] ^= 1;
    await writeFile(modelPath, changed);
    await expect(runReanalysis({ ...config, resume: true }, dependencies)).rejects.toThrow(
      'no coincide',
    );
    expect(search).toHaveBeenCalledTimes(1);
    await writeFile(modelPath, modelBytes);
    const complete = await runReanalysis({ ...config, resume: true }, dependencies);
    expect(complete.status).toBe('complete');
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('rejects material relabelling of data without an explicit development role', async () => {
    const { options } = await fixture();
    await expect(
      runReanalysis({ ...options, target: 'material-residual-v1' }, { modules, sourceHashes: {} }),
    ).rejects.toThrow('sourceRole');
  });
  it('samples reproducibly with a strict per-game gap and limit', () => {
    const selected = selectPositionIndices(100, 8, 7, 22);
    expect(selected).toHaveLength(8);
    expect(selectPositionIndices(100, 8, 7, 22)).toEqual(selected);
    expect(selectPositionIndices(100, 8, 7, 23)).not.toEqual(selected);
    expect(selected.every((value, index) => index === 0 || value - selected[index - 1] >= 7)).toBe(
      true,
    );
    expect(selectPositionIndices(3, 8, 4, 22)).toHaveLength(1);
  });

  it('preserves replay groups across filenames/formats and ignores adjudicated outcomes', () => {
    const game = trajectory();
    const fromDataset = parseResearchInput(dataset([game, { ...game, gameId: 'duplicate' }]));
    const fromArena = parseResearchInput(
      JSON.stringify({
        format: 'hexagonal-neural-arena',
        version: 1,
        rules,
        games: [{ ...game, outcome: { type: 'win', winner: 0, reason: 'timeout' } }],
      }),
    );
    expect(fromDataset).toHaveLength(1);
    expect(fromArena[0].gameId).toBe(fromDataset[0].gameId);
    expect(reconstructResearchGame(fromArena[0], modules).knownOutcome).toBeNull();
    const changed = { ...game, rules: { ...rules, repetition: 3 } };
    expect(parseResearchInput(dataset([changed]))[0].gameId).not.toBe(fromDataset[0].gameId);
  });

  it('reconstructs real board wins and rejects illegal source trajectories', () => {
    const initialState = engine.createGameState([
      { id: 'own', type: 'fortress', owner: 0, hp: 1, position: { q: -5, r: 0 } },
      { id: 'enemy', type: 'fortress', owner: 1, hp: 1, position: { q: 1, r: 0 } },
      { id: 'soldier', type: 'soldier', owner: 0, facing: 2, position: { q: 0, r: 0 } },
    ]);
    const action = engine
      .getAllLegalActions(initialState)
      .find(
        (candidate) =>
          engine.applyAction(initialState, candidate, rules).state.outcome?.type === 'win',
      );
    expect(action).toBeDefined();
    const game = parseResearchInput(dataset([{ initialState, actions: [action], rules }]))[0];
    expect(reconstructResearchGame(game, modules).knownOutcome).toEqual({
      type: 'win',
      winner: 0,
      reason: 'fortress',
    });
    expect(() =>
      reconstructResearchGame(
        { ...game, actions: [{ kind: 'rotate', pieceId: 'missing', facing: 0 }] },
        modules,
      ),
    ).toThrow(/Replay ilegal/);
  });

  it('deduplicates both sparse perspectives together and retains rules in the identity', () => {
    const features = [
      [1, 4, 3],
      [5, 7],
    ];
    expect(positionFingerprint(features, rules)).toBe(
      positionFingerprint(
        [
          [3, 1, 4],
          [7, 5],
        ],
        rules,
      ),
    );
    expect(positionFingerprint(features, rules)).not.toBe(
      positionFingerprint(features, { ...rules, repetition: 3 }),
    );
    expect(() =>
      parseResearchInput(dataset([{ ...trajectory(), rules: { repetition: 0 } }])),
    ).toThrow(/Regla incompatible/);
  });
});

describe('reanalysis checkpoints and classical teacher', () => {
  it('spreads a small total quota across independent games and restores the previous atomic output', async () => {
    const game = trajectory();
    const { output, options } = await fixture([
      game,
      { ...game, rules: { ...rules, repetition: 3 } },
      { ...game, rules: { ...rules, noProgressPlyLimit: 80 } },
    ]);
    const search = vi.fn(teacher);
    const dependencies = { modules, search, sourceHashes: {} };
    const limited = await runReanalysis({ ...options, 'max-search-ms': 40 }, dependencies);
    const previousOutput = await readFile(output, 'utf8');
    expect(limited.cursor).toBe(2);
    const complete = await runReanalysis({ ...options, resume: true }, dependencies);
    expect(new Set(complete.samples.map((sample) => sample.gameId)).size).toBe(3);
    expect(complete.acceptedPositions).toBe(3);
    const currentOutput = await readFile(output, 'utf8');
    // Simulate interruption after the checkpoint rename and before the dataset rename.
    await writeFile(output, previousOutput);
    const restored = await runReanalysis({ ...options, resume: true }, dependencies);
    expect(restored.cursor).toBe(3);
    expect(await readFile(output, 'utf8')).toBe(currentOutput);
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('emits paired compatible residual labels, teacher provenance and probe disagreement', async () => {
    const { output, options } = await fixture([{ ...trajectory(), familyId: 'shared-opening' }]);
    const search = vi.fn((position, config) => {
      expect(config.evaluate).toBeUndefined();
      expect(config.searchProfile).toBe('pvs-threats');
      expect(config.rangedPlay).toBe(true);
      const result = teacher(position, config);
      if (config.budgetMs === 40) result.metadata.score = 100;
      return result;
    });
    const report = await runReanalysis(
      { ...options, 'probe-budget-ms': 40 },
      {
        modules,
        search,
        sourceHashes: { teacher: 'fixed' },
      },
    );
    expect(report.status).toBe('complete');
    expect(report.acceptedPositions).toBe(3);
    expect(search).toHaveBeenCalledTimes(6);
    const rows = (await readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
    expect(rows[0]).toMatchObject({
      target: 'classic-residual-v1',
      evaluationVersion: 'strategic-v2',
      teacher: { neural: false },
    });
    const samples = rows.filter((row) => row.kind === 'sample');
    expect(samples).toHaveLength(6);
    expect(samples.every((sample) => sample.familyId === 'shared-opening')).toBe(true);
    expect(
      rows.filter((row) => row.kind === 'game').every((row) => row.familyId === 'shared-opening'),
    ).toBe(true);
    expect(new Set(samples.map((sample) => sample.gameId))).not.toContain('shared-opening');
    for (let index = 0; index < samples.length; index += 2) {
      expect(samples[index].teacher).toBeCloseTo(-samples[index + 1].teacher);
      expect(samples[index].teacher).toBeCloseTo(
        Math.max(-1, Math.min(1, (samples[index].teacherScore - samples[index].baseline) / 2000)),
      );
      expect(samples[index].outcome).toBeNull();
      expect(samples[index].confidence.absoluteScoreDelta).toBe(50);
      expect(samples[index].teacherSearch.principalVariationAvailable).toBe(false);
    }
    await expect(readFile(`${output}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects incomplete or insufficient teacher depth without exporting one perspective', async () => {
    const { options } = await fixture();
    let index = 0;
    const report = await runReanalysis(options, {
      modules,
      sourceHashes: {},
      search: (position, config) => {
        const result = teacher(position, config);
        result.metadata.completedDepth = index++;
        return result;
      },
    });
    expect(report.acceptedPositions).toBe(1);
    expect(report.rejectedPositions).toBe(2);
    expect(report.samples).toHaveLength(2);
  });

  it('resumes a nominally limited pilot without repeating searches and validates input/code/settings', async () => {
    const { input, output, options } = await fixture();
    const search = vi.fn(teacher);
    const dependencies = { modules, search, sourceHashes: { teacher: 'fixed' } };
    const first = await runReanalysis({ ...options, 'max-search-ms': 20 }, dependencies);
    expect(first.status).toBe('budget-limited');
    expect(first.cursor).toBe(1);
    await writeFile(`${output}.lock`, JSON.stringify({ pid: 2147483647, token: 'dead-owner' }));
    await expect(
      runReanalysis({ ...options, resume: true, seed: 18 }, dependencies),
    ).rejects.toThrow(/no coincide/);
    await expect(
      runReanalysis(
        { ...options, resume: true },
        { ...dependencies, sourceHashes: { teacher: 'changed' } },
      ),
    ).rejects.toThrow(/no coincide/);
    const resumed = await runReanalysis({ ...options, resume: true }, dependencies);
    expect(resumed.status).toBe('complete');
    expect(resumed.samples).toHaveLength(6);
    expect(search).toHaveBeenCalledTimes(3);
    await writeFile(input, `${await readFile(input, 'utf8')}\n`);
    await expect(runReanalysis({ ...options, resume: true }, dependencies)).rejects.toThrow(
      /no coincide/,
    );
  });

  it('preserves foreign locks and rejects externally modified output', async () => {
    const { output, options } = await fixture();
    const foreignLock = JSON.stringify({ pid: process.pid, token: 'foreign-owner' });
    await writeFile(`${output}.lock`, foreignLock);
    await expect(runReanalysis(options, { modules, sourceHashes: {} })).rejects.toThrow(
      /experimento activo/,
    );
    expect(await readFile(`${output}.lock`, 'utf8')).toBe(foreignLock);
    await rm(`${output}.lock`);
    await runReanalysis(options, { modules, sourceHashes: {}, search: teacher });
    await writeFile(output, 'manual-work');
    await expect(
      runReanalysis({ ...options, resume: true }, { modules, sourceHashes: {} }),
    ).rejects.toThrow(/ha cambiado/);
    expect(await readFile(output, 'utf8')).toBe('manual-work');
  });
});
