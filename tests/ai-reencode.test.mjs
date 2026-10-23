import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import * as neural from '../src/ai-neural';
import { reencodeRows, runReencode } from '../scripts/ai/reencode.mjs';

const modules = { engine, neural };
const rules = { repetition: null, noProgressPlyLimit: null, orientationOnlyTurnLimit: 5 };
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const copy = (value) => JSON.parse(JSON.stringify(value));

function teacherRows() {
  const initialState = engine.createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
    { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 0 },
    { id: 'enemy', type: 'soldier', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
  ]);
  const states = new Map([[0, initialState]]);
  const actions = [];
  let state = initialState;
  const apply = (action) => {
    if (!action) throw new Error('Fixture sin orden legal.');
    const next = engine.applyAction(state, action, rules);
    if (!next.ok) throw new Error('Fixture ilegal.');
    state = next.state;
    actions.push(action);
    states.set(state.ply, state);
  };
  for (let count = 1; count <= 4; count += 1) {
    apply(
      engine
        .getAllLegalActions(state)
        .find(
          (action) =>
            action.kind === 'orient' && action.pieceId === 'tank' && action.cannon === count,
        ),
    );
    apply(
      engine
        .getAllLegalActions(state)
        .find(
          (action) =>
            action.kind === 'rotate' && action.pieceId === 'enemy' && action.facing === count,
        ),
    );
  }
  apply(
    engine
      .getAllLegalActions(state)
      .find((action) => action.kind === 'move' && action.pieceId === 'tank'),
  );
  apply(
    engine
      .getAllLegalActions(state)
      .find((action) => action.kind === 'move' && action.pieceId === 'enemy'),
  );
  const samples = [];
  for (const ply of [0, 3, 6, 8, 10]) {
    for (const perspective of [0, 1]) {
      const sign = perspective === 0 ? 1 : -1;
      samples.push({
        kind: 'sample',
        gameId: 'teacher-game',
        familyId: 'teacher-family',
        ply,
        perspective,
        features: neural.encodeNeuralFeatures(
          states.get(ply),
          perspective,
          rules,
          neural.NEURAL_FEATURE_SCHEMA,
        ),
        rules: { ...rules },
        teacher: (sign * (ply + 1)) / 100,
        outcome: null,
        teacherScore: sign * (200 + ply),
        baseline: sign * (100 + ply),
        target: sign * 0.5,
        fingerprint: `original-v1-${ply}`,
        teacherSearch: { completedDepth: 6, score: 200 + ply, principalVariation: null },
        confidence: { absoluteScoreDelta: 4, sameAction: true, probe: { completedDepth: 3 } },
        labelProvenance: { frozenTeacher: 'old-runtime', opaque: ['keep', 42] },
      });
    }
  }
  return [
    {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema: neural.NEURAL_FEATURE_SCHEMA,
      inputSize: neural.NEURAL_INPUT_SIZE,
      teacherScale: 10000,
      target: 'classic-residual-v1',
      residualScale: 2000,
      rules: 'Explicit per game and sample',
      sourceHashes: { 'src/ai-neural.ts': 'frozen-v1', 'src/ai.ts': 'original-teacher' },
      teacher: { neural: false, evaluator: 'classic', searchProfile: 'pvs-threats' },
      confidencePolicy: { unchanged: true },
    },
    {
      kind: 'game',
      gameId: 'teacher-game',
      familyId: 'teacher-family',
      initialState,
      actions,
      rules: { ...rules },
      finalPly: state.ply,
      outcome: state.outcome,
      custom: { untouched: true },
    },
    { kind: 'audit', notes: ['preserve unknown provenance rows'] },
    ...samples,
  ];
}

describe('verified feature-only V1 to V2 conversion', () => {
  it('replays actual orientation counters and preserves every teacher, confidence and source field', () => {
    const rows = teacherRows();
    const snapshot = copy(rows);
    const converted = reencodeRows(rows, neural.NEURAL_FEATURE_SCHEMA_V2, modules);
    expect(rows).toEqual(snapshot);
    expect(converted).toHaveLength(rows.length);
    expect(converted[0]).toMatchObject({
      schema: 'hex-sparse-v2',
      inputSize: 5203,
      sourceHashes: rows[0].sourceHashes,
    });
    const { featureTransform, ...newHeader } = converted[0];
    const oldHeader = { ...rows[0] };
    for (const header of [newHeader, oldHeader]) {
      delete header.schema;
      delete header.inputSize;
    }
    expect(newHeader).toEqual(oldHeader);
    expect(featureTransform).toMatchObject({
      positions: 5,
      samples: 10,
      games: 1,
      teacherLabelsAndProvenancePreserved: true,
    });
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index].kind !== 'sample') {
        expect(converted[index]).toEqual(rows[index]);
        continue;
      }
      const { features: previous, ...originalFields } = rows[index];
      const { features: next, ...preservedFields } = converted[index];
      expect(preservedFields).toEqual(originalFields);
      expect(next.slice(0, -3)).toEqual(previous);
      if (rows[index].ply === 8) expect(next.slice(-3)).toEqual([5184, 5186, 5195]);
      if (rows[index].ply === 10) expect(next.slice(-3)).toEqual([5184, 5190, 5199]);
    }
    expect(reencodeRows(rows, neural.NEURAL_FEATURE_SCHEMA_V2, modules)).toEqual(converted);
  });

  it('requires exact original V1 vector order rather than matching only the set of indices', () => {
    const rows = teacherRows();
    rows.find((row) => row.kind === 'sample').features.reverse();
    expect(() => reencodeRows(rows, 'hex-sparse-v2', modules)).toThrow(
      'V1 no coinciden exactamente',
    );
  });

  it('rejects illegal journals even after the last retained sample and never drops bad rows', () => {
    const rows = teacherRows();
    rows
      .find((row) => row.kind === 'game')
      .actions.push({ kind: 'rotate', pieceId: 'missing', facing: 0 });
    expect(() => reencodeRows(rows, 'hex-sparse-v2', modules)).toThrow('Replay ilegal');
  });

  it('requires a unique pair 0/1, a known trajectory and an actual absolute ply', () => {
    const rows = teacherRows();
    const sample = rows.find((row) => row.kind === 'sample');
    expect(() => reencodeRows([...rows, copy(sample)], 'hex-sparse-v2', modules)).toThrow(
      'duplicada',
    );
    expect(() =>
      reencodeRows(
        rows.filter((row) => row !== sample),
        'hex-sparse-v2',
        modules,
      ),
    ).toThrow('pareja completa');
    const orphan = copy(rows);
    orphan.find((row) => row.kind === 'sample').gameId = 'missing';
    expect(() => reencodeRows(orphan, 'hex-sparse-v2', modules)).toThrow('sin trayectoria');
    const nonexistentPly = copy(rows);
    for (const row of nonexistentPly.filter((value) => value.kind === 'sample' && value.ply === 10))
      row.ply = 999;
    expect(() => reencodeRows(nonexistentPly, 'hex-sparse-v2', modules)).toThrow(
      'ply no pertenece',
    );
  });

  it('validates shared family, rules and opposite targets without recomputing their values', () => {
    for (const [field, replacement, message] of [
      ['familyId', 'wrong-family', 'Familia contradictoria'],
      ['rules', { ...rules, orientationOnlyTurnLimit: 6 }, 'Reglas contradictorias'],
      ['teacher', 0.8, 'teacher no opuestas'],
      ['target', 0.8, 'target no opuestas'],
      ['teacherScore', 900, 'teacherScore no opuestas'],
    ]) {
      const rows = teacherRows();
      rows.find((row) => row.kind === 'sample')[field] = replacement;
      expect(() => reencodeRows(rows, 'hex-sparse-v2', modules)).toThrow(message);
    }
  });

  it('accepts legacy grouping/rules only when their explicit shared defaults agree', () => {
    const rows = teacherRows();
    rows[0].rules = { ...rules, orientationOnlyTurnLimit: null };
    for (const row of rows) {
      if (row.kind === 'sample' || row.kind === 'game') {
        delete row.familyId;
        delete row.rules;
      }
    }
    // V1 has no orientation-limit features, so the preserved original vectors still verify.
    const converted = reencodeRows(rows, 'hex-sparse-v2', modules);
    expect(
      converted
        .filter((row) => row.kind === 'sample')
        .every((row) => row.features.slice(-3).join(',') === '5183,5185,5194'),
    ).toBe(true);
    expect(
      converted
        .filter((row) => row.kind === 'sample')
        .every((row) => !('familyId' in row) && !('rules' in row)),
    ).toBe(true);
  });

  it('rejects already transformed or unknown feature contracts', () => {
    const rows = teacherRows();
    expect(() => reencodeRows(rows, 'hex-sparse-v3', modules)).toThrow('destino');
    rows[0].schema = 'hex-sparse-v2';
    rows[0].inputSize = 5203;
    expect(() => reencodeRows(rows, 'hex-sparse-v2', modules)).toThrow('dataset teacher V1');
  });
});

describe('exclusive reencoding outputs and separate provenance', () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'hex-reencode-'));
    directories.push(directory);
    const input = join(directory, 'teacher-v1.jsonl');
    const output = join(directory, 'teacher-v2.jsonl');
    const report = join(directory, 'conversion.json');
    const rows = teacherRows();
    await writeFile(input, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    return { input, output, report, rows };
  }

  it('records unchanged input/source hashes and leaves the teacher sourceHashes untouched', async () => {
    const options = await fixture();
    const before = await readFile(options.input, 'utf8');
    const result = await runReencode(options, { modules });
    expect(result).toMatchObject({
      status: 'complete',
      samples: 10,
      positions: 5,
      teacherSourceHashesPreserved: true,
      searchRepeated: false,
      published: false,
    });
    expect(result.input.sha256Before).toBe(result.input.sha256After);
    expect(result.encoderSourceHashesBefore).toEqual(result.encoderSourceHashesAfter);
    expect(await readFile(options.input, 'utf8')).toBe(before);
    const converted = (await readFile(options.output, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(converted[0].sourceHashes).toEqual(options.rows[0].sourceHashes);
    expect(converted[0].featureTransform.encoderSourceHashes['src/ai-neural.ts']).not.toBe(
      'frozen-v1',
    );
    expect(converted[0].featureTransform.inputDataset.sha256).toBe(result.input.sha256Before);
    expect(JSON.parse(await readFile(options.report, 'utf8'))).toEqual(result);
  });

  it('refuses an existing output/report or matching paths without overwriting unknown files', async () => {
    const options = await fixture();
    await writeFile(options.output, 'user-owned-output');
    await expect(runReencode(options, { modules })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(options.output, 'utf8')).toBe('user-owned-output');
    await expect(runReencode({ ...options, output: options.input }, { modules })).rejects.toThrow(
      'rutas distintas',
    );
    await expect(runReencode({ ...options, report: options.input }, { modules })).rejects.toThrow(
      'rutas distintas',
    );
    await rm(options.output);
    await writeFile(options.report, 'user-owned-report');
    await expect(runReencode(options, { modules })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(options.report, 'utf8')).toBe('user-owned-report');
    await expect(readFile(options.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
