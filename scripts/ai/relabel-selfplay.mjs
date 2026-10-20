import { readFile, open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArguments } from './shared.mjs';
import { trainingTarget } from './selfplay-policy.mjs';

const options = parseArguments(process.argv.slice(2), {
  input: { type: 'string', required: true },
  output: { type: 'string', required: true },
  'outcome-weight': { type: 'number', default: 0.25, min: 0, max: 1 },
  'outcome-decay': { type: 'number', default: 0.98, min: 0, max: 1 },
});
const rows = (await readFile(resolve(options.input), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const header = rows[0];
if (
  header.kind !== 'metadata' ||
  header.target !== 'classic-residual-v1' ||
  header.residualScale !== 2000 ||
  header.residualBaseline !== 'classic+ranged-v1'
) {
  throw new Error('Se necesita un dataset residual de autojuego con baseline classic+ranged-v1.');
}
const games = new Map(rows.filter((row) => row.kind === 'game').map((game) => [game.gameId, game]));
await mkdir(dirname(resolve(options.output)), { recursive: true });
const output = await open(resolve(options.output), 'wx');
try {
  for (const row of rows) {
    if (row.kind === 'metadata') {
      row.labelVersion = 'bounded-outcome-v2';
      row.relabel = { ...options, source: resolve(options.input) };
    } else if (row.kind === 'sample') {
      const game = games.get(row.gameId);
      if (!game || !Number.isFinite(row.teacherScore) || !Number.isFinite(row.baseline)) {
        throw new Error(`Muestra sin partida o valoración original: ${row.gameId}`);
      }
      row.teacher = trainingTarget({
        ...row,
        teacherScore: row.teacherScore,
        residual: true,
        outcomeWeight: options['outcome-weight'],
        outcomeDecay: options['outcome-decay'],
        remainingPlies: game.finalPly - row.ply,
      });
    }
    await output.write(`${JSON.stringify(row)}\n`);
  }
} finally {
  await output.close();
}
console.log(`Dataset reetiquetado sin repetir búsquedas: ${resolve(options.output)}`);
