import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createGameState } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import {
  appendAction,
  concludeMatch,
  createMatchRecord,
  serializeRecord,
} from '../src/match-record';
import type { Piece } from '../src/types';

it('prepares legal exports, deduplicates reexports and keeps resignations out of board labels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hex-prepare-'));
  try {
    const pieces: Piece[] = [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 1 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 1 },
      { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: -3 } },
    ];
    const config = createClassicConfig({ mode: 'machine', difficulty: 'expert' });
    config.setup = pieces.map((piece) => ({ id: piece.id, piece }));
    const record = createMatchRecord(config, createGameState(pieces, 1));
    const completed = appendAction(record, { kind: 'move', pieceId: 'fast', to: { q: 0, r: -5 } });
    const unfinished = appendAction(record, { kind: 'move', pieceId: 'fast', to: { q: 1, r: -3 } });
    const resignation = concludeMatch(record, { type: 'win', winner: 0, reason: 'resignation' });
    await writeFile(join(directory, 'completed-a.json'), serializeRecord(completed));
    await writeFile(join(directory, 'completed-b.json'), serializeRecord(completed));
    await writeFile(join(directory, 'unfinished.json'), serializeRecord(unfinished));
    await writeFile(join(directory, 'resignation.json'), serializeRecord(resignation));
    const output = join(directory, 'prepared.jsonl');
    await promisify(execFile)(process.execPath, [
      resolve('scripts/ai/prepare-replays.mjs'),
      '--records',
      directory,
      '--output',
      output,
      '--positions',
      '2',
      '--budget-ms',
      '200',
      '--depth',
      '1',
    ]);
    const report: {
      status: string;
      games: { outcome: unknown; externalConclusion: unknown; samples: number }[];
    } = JSON.parse(await readFile(`${output}.report.json`, 'utf8'));
    expect(report.status).toBe('complete');
    expect(report.games).toHaveLength(3);
    expect(report.games.filter((game) => game.outcome)).toHaveLength(1);
    const resign = report.games.find((game) => game.externalConclusion)!;
    expect(resign.outcome).toBeNull();
    expect(resign.samples).toBe(0);
    const rows: { kind: string; gameId?: string; outcome?: number | null; perspective?: number }[] =
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    const samples = rows.filter((row) => row.kind === 'sample');
    expect(samples).toHaveLength(4);
    expect(samples.map((row) => row.outcome)).toEqual(expect.arrayContaining([1, -1, null]));
    for (let index = 0; index < samples.length; index += 2) {
      expect(samples[index].gameId).toBe(samples[index + 1].gameId);
      expect([samples[index].perspective, samples[index + 1].perspective]).toEqual([0, 1]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
