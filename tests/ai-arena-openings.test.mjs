import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import { createEndgameCases } from '../scripts/ai/endgame-cases.mjs';
import {
  loadOpeningBook,
  openingBookResumeMatches,
  prepareOpeningBook,
  reconstructBookOpening,
  restoreBookCheckpoint,
} from '../scripts/ai/arena-openings.mjs';

const rules = { repetition: null, noProgressPlyLimit: 120, orientationOnlyTurnLimit: 3 };
const state = () =>
  engine.createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 2 },
    { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 }, missilesRemaining: 2 },
    { id: 'defender', type: 'soldier', owner: 1, position: { q: 4, r: -4 }, facing: 3 },
  ]);
const entry = (id = 'one', familyId = 'family-one') => ({
  id,
  familyId,
  seed: 17,
  initialState: state(),
  actions: [{ kind: 'shoot', pieceId: 'launcher', targetId: 'f1' }],
  rules,
});
const book = (entries) => ({ format: 'hex-arena-openings-v1', scope: 'endgame', entries });

describe('arena opening books', () => {
  it('replays the prefix with its rules while retaining the original state, history and counters', () => {
    const original = entry();
    const snapshot = JSON.stringify(original);
    const prepared = prepareOpeningBook(engine, book([original]), { pairs: 1, seed: 8 });
    const opening = prepared.openings[0];
    expect(opening.initialState).toEqual(original.initialState);
    expect(opening.state).toEqual(
      engine.applyAction(original.initialState, original.actions[0], rules).state,
    );
    expect(opening.state.history).toHaveLength(1);
    expect(opening.state.firstFortressDamageBy).toBe(0);
    expect(opening.state.ply).toBe(1);
    expect(opening.rules).toEqual(rules);
    expect(opening.scope).toBe('endgame');
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('selects one deterministic member per family and refuses to inflate the number of pairs', () => {
    const document = book([entry('a'), entry('b'), entry('c', 'family-two')]);
    const first = prepareOpeningBook(engine, document, { pairs: 2, seed: 8 });
    const again = prepareOpeningBook(engine, document, { pairs: 2, seed: 8 });
    expect(first.identity).toEqual(again.identity);
    expect(first.identity.totalEntries).toBe(3);
    expect(first.identity.totalFamilies).toBe(2);
    expect(new Set(first.openings.map((opening) => opening.familyId)).size).toBe(2);
    expect(() => prepareOpeningBook(engine, document, { pairs: 3, seed: 8 })).toThrow(
      'familias distintas',
    );
  });

  it('converts the constructed endgame book without treating six variants as six families', () => {
    const document = { format: 'hex-engine-endgames-v1', cases: createEndgameCases(engine) };
    const prepared = prepareOpeningBook(engine, document, { pairs: 4, seed: 8 });
    expect(prepared.identity.totalEntries).toBe(6);
    expect(prepared.identity.totalFamilies).toBe(4);
    expect(prepared.openings.every((opening) => opening.scope === 'endgame')).toBe(true);
    expect(prepared.openings.filter((opening) => opening.familyId === 'rim-cannon')).toHaveLength(
      1,
    );
    expect(() => prepareOpeningBook(engine, document, { pairs: 6, seed: 8 })).toThrow(
      'familias distintas',
    );
  });

  it('changes resume identity when the raw book hash, selected rules or selection seed changes', () => {
    const document = book([entry()]);
    const identity = (sha256, seed = 8) => ({
      openingBook: prepareOpeningBook(engine, document, { pairs: 1, seed, sha256 }).identity,
    });
    expect(openingBookResumeMatches(identity('same'), identity('same'))).toBe(true);
    expect(openingBookResumeMatches(identity('old'), identity('new'))).toBe(false);
    expect(openingBookResumeMatches(identity('same'), identity('same', 9))).toBe(false);
    const differentRules = JSON.parse(JSON.stringify(identity('same')));
    differentRules.openingBook.selected[0].rules.orientationOnlyTurnLimit = 4;
    expect(openingBookResumeMatches(identity('same'), differentRules)).toBe(false);
    expect(openingBookResumeMatches({}, {})).toBe(true);
    expect(openingBookResumeMatches({}, identity('same'))).toBe(false);
  });

  it('hashes the actual file contents so editing a book prevents a stale resume', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hex-arena-openings-'));
    const path = join(directory, 'book.json');
    try {
      const payload = JSON.stringify(book([entry()]));
      await writeFile(path, payload);
      const original = await loadOpeningBook(engine, path, { pairs: 1, seed: 8 });
      await writeFile(path, `${payload}\n`);
      const changed = await loadOpeningBook(engine, path, { pairs: 1, seed: 8 });
      expect(original.identity.selected).toEqual(changed.identity.selected);
      expect(original.identity.sha256).not.toBe(changed.identity.sha256);
      expect(
        openingBookResumeMatches(
          { openingBook: original.identity },
          { openingBook: changed.identity },
        ),
      ).toBe(false);
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
  });

  it('retains different explicit rule policies on different families', () => {
    const first = entry('one', 'one');
    const second = entry('two', 'two');
    second.rules = { repetition: 3, noProgressPlyLimit: null, orientationOnlyTurnLimit: null };
    const prepared = prepareOpeningBook(engine, book([first, second]), { pairs: 2, seed: 8 });
    expect(prepared.openings.map((opening) => opening.rules)).toEqual([first.rules, second.rules]);
    expect(prepared.identity.selected.map((opening) => opening.rules)).toEqual([
      first.rules,
      second.rules,
    ]);
  });

  it('restores both model roles from the same unrotated original position and legal path', () => {
    const opening = reconstructBookOpening(engine, entry());
    const roles = [0, 1].map((neuralPlayer) => ({
      neuralPlayer,
      state: restoreBookCheckpoint(engine, opening),
    }));
    expect(roles.map((role) => role.neuralPlayer)).toEqual([0, 1]);
    expect(roles[0].state).toEqual(roles[1].state);
    expect(roles[0].state.pieces.find((piece) => piece.id === 'f0')).toMatchObject({
      owner: 0,
      position: { q: 0, r: -5 },
    });
    const reply = engine.getAllLegalActions(opening.state)[0];
    const finalState = engine.applyAction(opening.state, reply, opening.rules).state;
    const checkpoint = {
      initialState: opening.initialState,
      rules: opening.rules,
      actions: [...opening.actions, reply],
      finalState,
    };
    expect(restoreBookCheckpoint(engine, opening, checkpoint)).toEqual(finalState);
    expect(() => restoreBookCheckpoint(engine, opening, { ...checkpoint, actions: [] })).toThrow(
      'prefijo',
    );
    expect(() =>
      restoreBookCheckpoint(engine, opening, { ...checkpoint, finalState: opening.state }),
    ).toThrow('estado final');
  });

  it('rejects illegal prefixes, duplicate IDs, missing rules and prefixes made terminal by their own rules', () => {
    expect(() =>
      reconstructBookOpening(engine, {
        ...entry(),
        actions: [{ kind: 'shoot', pieceId: 'absent', targetId: 'f1' }],
      }),
    ).toThrow('Prefijo ilegal');
    expect(() => reconstructBookOpening(engine, { ...entry(), rules: undefined })).toThrow(
      'reglas explícitas',
    );
    expect(() =>
      prepareOpeningBook(engine, book([entry(), entry()]), { pairs: 1, seed: 8 }),
    ).toThrow('duplicado');
    const terminal = entry();
    terminal.initialState.pieces.find((piece) => piece.id === 'f1').hp = 1;
    expect(() => reconstructBookOpening(engine, terminal)).toThrow('ya termina');
    const oriented = entry();
    oriented.initialState.activePlayer = 1;
    oriented.actions = [{ kind: 'rotate', pieceId: 'defender', facing: 0 }];
    oriented.rules = { ...rules, orientationOnlyTurnLimit: 1 };
    expect(() => reconstructBookOpening(engine, oriented)).toThrow('ya termina');
  });
});
