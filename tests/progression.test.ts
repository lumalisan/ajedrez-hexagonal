import { describe, expect, it } from 'vitest';
import { createGameState, getAllLegalActions } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { appendAction, concludeMatch, createMatchRecord, replayRecord } from '../src/match-record';
import { createAchievementProgress } from '../src/achievements';
import {
  createPlayerProgression,
  xpForLevel,
  levelProgress,
  eloK,
  calculateElo,
  evaluateProgressionMatch,
  registerProgressionMatch,
  recordActivity,
  recordLearning,
  PROGRESSION_ACHIEVEMENTS,
  progressionValue,
  parsePlayerProgression,
  rankingSummary,
  migrateProgression,
  type PlayerProgression,
} from '../src/progression';
import type { AiDifficulty, Piece, Player } from '../src/types';

const AT = '2026-10-07T12:00:00.000Z';
const definition = (id: string) => PROGRESSION_ACHIEVEMENTS.find((entry) => entry.id === id)!;
function noAwards(): PlayerProgression {
  const progress = createPlayerProgression();
  for (const entry of PROGRESSION_ACHIEVEMENTS) progress.unlockedAt[entry.id] = AT;
  return progress;
}
function match(
  mode: 'local' | 'machine' = 'local',
  difficulty: AiDifficulty = 'recruit',
  plies = 0,
  winner: Player = 0,
) {
  let record = createMatchRecord(createClassicConfig({ mode, difficulty }));
  for (let index = 0; index < plies; index++)
    record = appendAction(record, getAllLegalActions(replayRecord(record))[0]);
  return concludeMatch(record, { type: 'win', winner, reason: 'resignation' });
}
function evaluate(
  record: ReturnType<typeof match>,
  progress = createPlayerProgression(),
  source: 'live' | 'import' | 'replay' = 'live',
  at = AT,
) {
  return evaluateProgressionMatch(registerProgressionMatch(progress, record), record, {
    source,
    at,
  });
}
function fixture(pieces: Piece[], owner: Player = 0, mode: 'machine' | 'local' = 'local') {
  const config = createClassicConfig({ mode, difficulty: 'expert' });
  const forts: Piece[] = [
    { id: 'cyan-fort', type: 'fortress', owner: 0, hp: 3, position: { q: -5, r: 0 } },
    { id: 'amber-fort', type: 'fortress', owner: 1, hp: 3, position: { q: 5, r: 0 } },
  ];
  config.setup = [...forts, ...pieces].map((piece) => ({ id: piece.id, piece }));
  return createMatchRecord(config, createGameState([...forts, ...pieces], owner));
}

describe('experiencia, niveles y categorías', () => {
  it.each([0, 1, 2, 3, 4, 59, 60, 61, 79, 80, 99, 100])(
    'cuenta turnos de dos órdenes para XP y logros con %i órdenes',
    (plies) => {
      const config = createClassicConfig({ mode: 'local', noProgressPlyLimit: null });
      config.victory.repetition = 0;
      config.options.orientationOnlyTurnLimit = null; // Legacy long-match fixtures.
      let record = createMatchRecord(config);
      for (let i = 0; i < plies; i++) {
        const action = getAllLegalActions(replayRecord(record)).find((a) => a.kind === 'rotate')!;
        record = appendAction(record, action);
      }
      record = concludeMatch(record, { type: 'win', winner: 0, reason: 'resignation' });
      const result = evaluate(record, noAwards());
      const evidence = result.progress.matches[record.createdAt];
      expect(evidence.battle?.rewards.find((r) => r.label === 'Turnos jugados')?.xp ?? 0).toBe(
        Math.floor(plies / 4),
      );
      expect(evidence.metrics.longMatches).toBe(Number(plies >= 100));
      expect(evidence.metrics.longWins).toBe(Number(plies >= 100));
      expect(evidence.metrics.quickWins).toBe(Number(plies < 80));
    },
  );
  it('empieza con nivel 0 y aplica la fórmula, incluidos los límites de categoría', () => {
    expect(levelProgress(0)).toMatchObject({
      level: 0,
      current: 0,
      required: 125,
      category: 'Principiante',
    });
    expect([0, 1, 2, 3, 4, 9, 99].map(xpForLevel)).toEqual([0, 125, 275, 450, 650, 2025, 133650]);
    for (const [level, category] of [
      [5, 'Avanzado'],
      [15, 'Experto'],
      [30, 'Maestro'],
      [50, 'Legendario'],
    ] as const) {
      expect(levelProgress(xpForLevel(level)).category).toBe(category);
      expect(levelProgress(xpForLevel(level) - 1).level).toBe(level - 1);
    }
    expect(levelProgress(999999).level).toBe(100);
  });
  it.each([
    ['recruit', 0, 15],
    ['recruit', 1, 25],
    ['tactical', 0, 25],
    ['tactical', 1, 50],
    ['commander', 0, 35],
    ['commander', 1, 75],
    ['expert', 0, 50],
    ['expert', 1, 100],
    ['neural', 0, 50],
    ['neural', 1, 100],
  ] as const)(
    'otorga XP contra %s con resultado %i incluso al rendirse sin órdenes',
    (difficulty, win, xp) => {
      const result = evaluate(match('machine', difficulty, 0, win ? 0 : 1), noAwards());
      expect(result.xpEarned).toBe(xp + 25);
      expect(result.progress.matches[Object.keys(result.progress.matches)[0]].metrics.matches).toBe(
        1,
      );
    },
  );
  it('da la bonificación diaria una sola vez y en local solo la duración', () => {
    const first = evaluate(match('local', 'recruit', 2), noAwards());
    expect(first.xpEarned).toBe(25);
    const another = { ...match('local', 'recruit', 4), createdAt: '2026-10-07T12:01:00.000Z' };
    const second = evaluate(another, first.progress);
    expect(second.xpEarned).toBe(1);
    const third = evaluate(
      { ...another, createdAt: '2026-10-08T12:00:00.000Z' },
      second.progress,
      'live',
      '2026-10-08T12:00:00.000Z',
    );
    expect(third.xpEarned).toBe(26);
  });
  it('limita la duración a 50 XP y concede la recompensa de tablas', () => {
    const config = createClassicConfig({
      mode: 'machine',
      difficulty: 'tactical',
      noProgressPlyLimit: null,
    });
    config.victory.repetition = 0;
    config.options.orientationOnlyTurnLimit = null; // Legacy long-match fixtures.
    let record = createMatchRecord(config);
    for (let index = 0; index < 204; index++) {
      const rotation = getAllLegalActions(replayRecord(record)).find(
        (action) => action.kind === 'rotate',
      );
      record = appendAction(record, rotation!);
    }
    record = concludeMatch(record, { type: 'draw', reason: 'blockade' });
    const result = evaluate(record, noAwards());
    expect(result.xpEarned).toBe(25 + 50 + 25);
    expect(result.progress.ratings.machine).toBe(1000);
  });
  it('no concede XP de partida ni Elo antes de un resultado terminal', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'machine' }));
    const result = evaluate(record, noAwards());
    expect(result.xpEarned).toBe(0);
    expect(result.progress.ratings.machine).toBe(1000);
    expect(result.progress.lastDailyMatch).toBeNull();
  });
  it.each(['import', 'replay'] as const)('no acredita una fuente %s', (source) => {
    const result = evaluate(match('machine'), noAwards(), source);
    expect(result.xpEarned).toBe(0);
    expect(result.progress.matches).toEqual({});
  });
  it('rechaza partidas no registradas, órdenes ilegales y Academia', () => {
    const record = match();
    expect(
      evaluateProgressionMatch(createPlayerProgression(), record, { source: 'live', at: AT })
        .xpEarned,
    ).toBe(0);
    expect(
      evaluate({ ...record, academySession: { scenarioId: 'movement', hintsRevealed: 0 } })
        .xpEarned,
    ).toBe(0);
    expect(
      evaluate({
        ...record,
        actions: [{ kind: 'rotate', pieceId: 'missing', facing: 0 }],
        currentAction: 1,
      }).xpEarned,
    ).toBe(0);
  });
  it('conserva el resultado y no duplica XP ni Elo después de recargar, deshacer y repetir', () => {
    const record = match('machine', 'expert', 2);
    const first = evaluate(record);
    const saved = parsePlayerProgression(JSON.stringify(first.progress));
    expect(saved).toEqual(first.progress);
    const repeated = evaluate(record, saved);
    expect(repeated.progress).toEqual(saved);
    expect(repeated.xpEarned).toBe(0);
    expect(evaluate({ ...record, currentAction: 0 }, saved).xpEarned).toBe(0);
  });
});

describe('catálogo y evidencia retrospectiva', () => {
  it('tiene exactamente quince visibles y cinco ocultos en cada categoría', () => {
    expect(new Set(PROGRESSION_ACHIEVEMENTS.map((entry) => entry.id)).size).toBe(100);
    for (let tier = 0; tier < 5; tier++) {
      expect(
        PROGRESSION_ACHIEVEMENTS.filter((entry) => entry.tier === tier && !entry.hidden),
      ).toHaveLength(15);
      expect(
        PROGRESSION_ACHIEVEMENTS.filter((entry) => entry.tier === tier && entry.hidden),
      ).toHaveLength(5);
    }
  });
  it('aplaza los premios hasta abrir la categoría y después utiliza partidas previas', () => {
    const progress = createPlayerProgression();
    for (let i = 0; i < 5; i++)
      progress.matches[`2026-10-0${i + 1}T12:00:00.000Z`] = {
        mode: 'machine',
        difficulty: 1,
        metrics: { wins: 1, matches: 1 },
        completedAt: AT,
        result: 1,
      };
    expect(progressionValue(progress, definition('p2-03'))).toBe(5);
    const before = recordActivity(progress, AT);
    expect(before.progress.unlockedAt['p2-03']).toBeUndefined();
    before.progress.xp = xpForLevel(5) - 25;
    const opened = recordLearning(before.progress, 'tutorial', AT);
    expect(opened.progress.unlockedAt['p2-03']).toBe(AT);
    expect(opened.unlocked).toContain('p2-03');
    expect(opened.progress.xp).toBeGreaterThanOrEqual(xpForLevel(5) + 75);
  });
  it('conserva la fecha real de una acción antes de abrir su nivel, incluso tras recargar', () => {
    const earned = '2026-10-06T12:00:00.000Z';
    let record = fixture(
      [
        { id: 'tank', type: 'medium', cannon: 2, owner: 0, position: { q: 0, r: 0 } },
        { id: 'enemy', type: 'fast', owner: 1, position: { q: 2, r: 0 } },
      ],
      0,
      'machine',
    );
    record = appendAction(record, { kind: 'shoot', pieceId: 'tank', targetId: 'enemy' });
    const initial = createPlayerProgression();
    // One more elimination crosses the cumulative threshold in the still-closed tier.
    initial.matches['2026-10-01T12:00:00.000Z'] = {
      mode: 'machine',
      difficulty: 3,
      metrics: { kills: 99 },
      completedAt: earned,
    };
    const during = evaluate(record, initial, 'live', earned).progress;
    expect(during.achievedAt['p2-10']).toBe(earned);
    expect(during.unlockedAt['p2-10']).toBeUndefined();
    const saved = parsePlayerProgression(JSON.stringify(during));
    saved.xp = xpForLevel(5) - 25;
    const opened = recordLearning(saved, 'tutorial', AT);
    expect(opened.progress.unlockedAt['p2-10']).toBe(earned);
    expect(recordLearning(opened.progress, 'tutorial', AT).xpEarned).toBe(0);
  });
  it('recupera la fecha de la partida que cruzó el umbral en perfiles antiguos', () => {
    const progress = createPlayerProgression();
    for (let day = 1; day <= 6; day++) {
      const at = `2026-10-0${day}T12:00:00.000Z`;
      progress.matches[at] = {
        mode: 'machine',
        difficulty: 1,
        metrics: { wins: 1 },
        completedAt: at,
        result: 1,
      };
    }
    progress.unlockedAt['p2-03'] = AT;
    const saved = parsePlayerProgression(JSON.stringify(progress));
    expect(saved.unlockedAt['p2-03']).toBe('2026-10-05T12:00:00.000Z');
    expect(saved.xp).toBe(progress.xp);
  });
  it('recuerda un umbral de clasificación alcanzado aunque después baje antes de abrir el nivel', () => {
    const earned = '2026-10-05T12:00:00.000Z';
    const progress = createPlayerProgression();
    progress.ratings.online = 1200;
    const achieved = recordActivity(progress, earned).progress;
    expect(achieved.achievedAt['p2-01']).toBe(earned);
    expect(achieved.unlockedAt['p2-01']).toBeUndefined();
    const saved = parsePlayerProgression(JSON.stringify(achieved));
    saved.ratings.online = 1100;
    saved.xp = xpForLevel(5) - 25;
    const opened = recordLearning(saved, 'tutorial', AT);
    expect(opened.unlocked).toContain('p2-01');
    expect(opened.progress.unlockedAt['p2-01']).toBe(earned);
  });
  it('Cielo despejado exige destruir el antiaéreo rival y se acredita al instante', () => {
    let record = fixture([
      { id: 'attacker', type: 'soldier', facing: 0, owner: 0, position: { q: 0, r: 0 } },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 0, r: -1 } },
    ]);
    expect(evaluate(record).unlocked).not.toContain('p1-20');
    record = appendAction(record, { kind: 'move', pieceId: 'attacker', to: { q: 0, r: -1 } });
    const result = evaluate(record);
    expect(result.unlocked).toContain('p1-20');
    expect(result.progress.matches[record.createdAt].metrics.enemyShieldDestroyed).toBe(1);
    expect(evaluate(record, parsePlayerProgression(JSON.stringify(result.progress))).xpEarned).toBe(
      0,
    );
  });
  it('no convierte A cubierto en Cielo despejado ni resta sus XP al migrar', () => {
    const progress = createPlayerProgression();
    progress.xp = 125;
    progress.unlockedAt['p1-20'] = AT;
    const raw = { ...progress, catalogRevision: undefined };
    const saved = parsePlayerProgression(JSON.stringify(raw));
    expect(saved.xp).toBe(125);
    expect(saved.unlockedAt['p1-20']).toBeUndefined();
    expect(saved.legacyUnlockedAt['p1-20:shieldSurvived']).toBe(AT);
    expect(parsePlayerProgression(JSON.stringify(saved))).toEqual(saved);
  });
  it('capturar el escudo rival y perder el propio no cuentan como destruir el rival', () => {
    let converted = fixture([
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: 0 } },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 0, r: -1 } },
    ]);
    converted = appendAction(converted, {
      kind: 'convert',
      pieceId: 'capturer',
      targetId: 'shield',
    });
    expect(evaluate(converted).unlocked).not.toContain('p1-20');
    let lost = fixture(
      [
        { id: 'enemy', type: 'soldier', facing: 0, owner: 1, position: { q: 0, r: 0 } },
        { id: 'shield', type: 'antiAir', owner: 0, position: { q: 0, r: -1 } },
      ],
      1,
    );
    lost = appendAction(lost, { kind: 'move', pieceId: 'enemy', to: { q: 0, r: -1 } });
    expect(evaluate(lost).unlocked).not.toContain('p1-20');
  });
  it.each([null, 300])(
    'las victorias con tiempo total %s acreditan el contador correcto',
    (seconds) => {
      const record = createMatchRecord(
        createClassicConfig({ mode: 'local', clockSeconds: seconds }),
      );
      const finished = concludeMatch(record, { type: 'win', winner: 0, reason: 'resignation' });
      expect(evaluate(finished).progress.matches[record.createdAt].metrics.timedWins).toBe(
        Number(seconds !== null),
      );
    },
  );
  it.each([
    ['p2-03', 5],
    ['p2-04', 3],
    ['p2-11', 100],
    ['p2-14', 10],
    ['p3-12', 200],
    ['p4-13', 2000],
    ['p4-14', 300],
    ['p5-12', 5000],
  ])('aplica el nuevo umbral de %s: %i', (id, target) => {
    expect(definition(String(id)).target).toBe(target);
  });
  it('cuenta las bajas locales para Se me ha ido de las manos', () => {
    const progress = createPlayerProgression();
    progress.matches[AT] = { mode: 'local', difficulty: 0, metrics: { kills: 10000 } };
    expect(progressionValue(progress, definition('p5-17'))).toBe(10000);
    expect(progressionValue(progress, definition('p5-12'))).toBe(0);
  });
  it('filtra dificultad mínima y modalidad sin atribuir partidas locales a logros de IA', () => {
    const progress = createPlayerProgression();
    progress.matches = {
      easy: { mode: 'machine', difficulty: 0, metrics: { wins: 20 } },
      medium: { mode: 'machine', difficulty: 1, metrics: { wins: 2 } },
      expert: { mode: 'machine', difficulty: 3, metrics: { wins: 1 } },
      local: { mode: 'local', difficulty: 0, metrics: { wins: 100 } },
    };
    expect(progressionValue(progress, definition('p2-03'))).toBe(3);
    expect(progressionValue(progress, definition('p3-03'))).toBe(1);
    expect(progressionValue(progress, definition('p1-05'))).toBe(0);
    expect(progressionValue(progress, definition('p4-02'))).toBe(0);
  });
  it('solo acredita Cian en partidas locales, tanto victorias como acciones', () => {
    expect(evaluate(match('local', 'recruit', 0, 1)).unlocked).not.toContain('p1-04');
    let record = fixture(
      [{ id: 'guest', type: 'soldier', owner: 1, facing: 0, position: { q: 0, r: 0 } }],
      1,
    );
    record = appendAction(record, { kind: 'rotate', pieceId: 'guest', facing: 1 });
    expect(evaluate(record).unlocked).not.toContain('p1-07');
  });
  it('acredita acciones al instante, sin duplicarlas tras recargar o deshacer', () => {
    let record = fixture([
      { id: 'soldier', type: 'soldier', owner: 0, facing: 0, position: { q: 0, r: 0 } },
    ]);
    record = appendAction(record, { kind: 'rotate', pieceId: 'soldier', facing: 1 });
    const initial = createPlayerProgression();
    const untouched = structuredClone(initial);
    const first = evaluate(record, initial);
    expect(first.unlocked).toContain('p1-07');
    expect(first.xpEarned).toBe(25);
    expect(initial).toEqual(untouched);
    const second = evaluate(record, parsePlayerProgression(JSON.stringify(first.progress)));
    expect(second.xpEarned).toBe(0);
    expect(second.progress.matches[record.createdAt].metrics.rotate).toBe(1);
  });
  it('destruir una capa de una pila acredita una sola baja y el logro oculto', () => {
    let record = fixture([
      { id: 'tank', type: 'medium', cannon: 2, owner: 0, position: { q: 0, r: 0 } },
      { id: 'enemy', type: 'soldier', facing: 0, owner: 1, position: { q: 2, r: 0 } },
      { id: 'air', type: 'drone', owner: 1, position: { q: 2, r: 0 } },
    ]);
    record = appendAction(record, { kind: 'shoot', pieceId: 'tank', targetId: 'enemy' });
    const result = evaluate(record);
    expect(result.progress.matches[record.createdAt]?.metrics.kills).toBe(1);
    expect(result.unlocked).toContain('p1-19');
    expect(result.unlocked).not.toContain('p1-17');
    expect(replayRecord(record).pieces.some((p) => p.id === 'air')).toBe(true);
  });
  it('no considera una baja rival el sacrificio del rival contra la fortaleza', () => {
    let record = fixture(
      [{ id: 'enemy', type: 'soldier', owner: 1, facing: 5, position: { q: -4, r: 0 } }],
      1,
    );
    record = appendAction(record, { kind: 'move', pieceId: 'enemy', to: { q: -5, r: 0 } });
    expect(replayRecord(record).pieces.some((p) => p.id === 'enemy')).toBe(false);
    expect(evaluate(record).progress.matches[record.createdAt].metrics.kills ?? 0).toBe(0);
  });
  it('acredita bajas antiaéreas aunque el evento identifique la unidad interceptada', () => {
    let record = fixture(
      [
        { id: 'enemy-drone', type: 'drone', owner: 1, position: { q: 0, r: 0 } },
        { id: 'shield', type: 'antiAir', owner: 0, position: { q: 1, r: 1 } },
      ],
      1,
    );
    record = appendAction(record, { kind: 'move', pieceId: 'enemy-drone', to: { q: 3, r: 0 } });
    expect(replayRecord(record).pieces.some((p) => p.id === 'enemy-drone')).toBe(false);
    const evidence = evaluate(record).progress.matches[record.createdAt];
    expect(evidence.metrics.kills).toBe(1);
    expect(evidence.metrics.airKillsMatch).toBe(1);
    expect(evidence.metrics.soldierKills ?? 0).toBe(0);
  });
  it('atribuye al asaltador los ataques realizados al transformar un vehículo', () => {
    let record = fixture([
      { id: 'vehicle', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'enemy', type: 'soldier', owner: 1, facing: 0, position: { q: 1, r: 0 } },
    ]);
    record = appendAction(record, {
      kind: 'transform',
      pieceId: 'vehicle',
      facing: 2,
      to: { q: 1, r: 0 },
    });
    expect(replayRecord(record).pieces.some((p) => p.id === 'enemy')).toBe(false);
    const evidence = evaluate(record).progress.matches[record.createdAt];
    expect(evidence.metrics.soldierKills).toBe(1);
    expect(evidence.metrics.stationaryMissileKills ?? 0).toBe(0);
  });
  it('reconoce dos disparos sin desplazarse y el golpe final al abandonar el lanzamisiles', () => {
    let record = fixture(
      [
        { id: 'launcher', type: 'long', owner: 0, position: { q: 4, r: 0 } },
        { id: 'target-a', type: 'soldier', owner: 1, facing: 0, position: { q: 1, r: 0 } },
        { id: 'target-b', type: 'soldier', owner: 1, facing: 0, position: { q: 1, r: 1 } },
        { id: 'idle', type: 'soldier', owner: 1, facing: 0, position: { q: 0, r: -4 } },
      ],
      0,
      'machine',
    );
    const fortress = record.initialState.pieces.find((p) => p.id === 'amber-fort');
    if (fortress?.type === 'fortress') fortress.hp = 1;
    record = appendAction(record, { kind: 'shoot', pieceId: 'launcher', targetId: 'target-a' });
    record = appendAction(record, { kind: 'rotate', pieceId: 'idle', facing: 1 });
    record = appendAction(record, { kind: 'shoot', pieceId: 'launcher', targetId: 'target-b' });
    record = appendAction(record, { kind: 'rotate', pieceId: 'idle', facing: 2 });
    record = appendAction(record, {
      kind: 'transform',
      pieceId: 'launcher',
      facing: 2,
      to: { q: 5, r: 0 },
    });
    expect(replayRecord(record).outcome).toMatchObject({ type: 'win', winner: 0 });
    const evidence = evaluate(record).progress.matches[record.createdAt];
    expect(evidence.metrics.stationaryMissileKills).toBe(2);
    expect(evidence.metrics.emptyMissiles).toBe(1);
    expect(evidence.metrics.missileSoldierFinish).toBe(1);
  });
  it('no confunde un lanzamisiles inicialmente vacío con haber gastado dos misiles', () => {
    let record = fixture(
      [{ id: 'launcher', type: 'long', owner: 0, missilesRemaining: 0, position: { q: 4, r: 0 } }],
      0,
      'machine',
    );
    const fortress = record.initialState.pieces.find((p) => p.id === 'amber-fort');
    if (fortress?.type === 'fortress') fortress.hp = 1;
    record = appendAction(record, {
      kind: 'transform',
      pieceId: 'launcher',
      facing: 2,
      to: { q: 5, r: 0 },
    });
    expect(replayRecord(record).outcome).toMatchObject({ type: 'win', winner: 0 });
    expect(
      evaluate(record).progress.matches[record.createdAt].metrics.missileSoldierFinish ?? 0,
    ).toBe(0);
  });
  it('cuenta rachas por días naturales, sin exigir partidas y sin duplicar visitas', () => {
    let progress = createPlayerProgression();
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07'])
      progress = recordActivity(progress, `${day}T12:00:00.000Z`).progress;
    expect(progress.activity).toMatchObject({ streak: 3, best: 3 });
    expect(progress.unlockedAt['p1-15']).toBeDefined();
    expect(recordActivity(progress, AT).progress).toBe(progress);
    expect(recordActivity(progress, '2026-10-09T12:00:00.000Z').progress.activity).toMatchObject({
      streak: 1,
      best: 3,
    });
  });
  it('solo acredita la lectura tras completar todos los capítulos conocidos', () => {
    let progress = recordLearning(createPlayerProgression(), 'story', AT, 'unknown', [
      'a',
      'b',
    ]).progress;
    expect(progress.storyChapters).toEqual([]);
    progress = recordLearning(progress, 'story', AT, 'a', ['a', 'b']).progress;
    expect(progress.story).toBe(false);
    const result = recordLearning(progress, 'story', AT, 'b', ['a', 'b']);
    expect(result.unlocked).toContain('p1-02');
    expect(recordLearning(result.progress, 'story', AT, 'b', ['a', 'b']).xpEarned).toBe(0);
  });
});

describe('Elo y persistencia', () => {
  it('usa los cinco factores K y redondea sin puntuaciones negativas', () => {
    expect([0, 9, 10, 24, 25, 49, 50, 99, 100].map(eloK)).toEqual([
      40, 40, 32, 32, 24, 24, 20, 20, 16,
    ]);
    expect(calculateElo(1000, 1000, 1, 0)).toBe(1020);
    expect(calculateElo(1000, 1000, 0.5, 0)).toBe(1000);
    expect(calculateElo(1000, 1000, 0, 0)).toBe(980);
    expect(calculateElo(0, 0, 0, 0)).toBe(0);
    expect(calculateElo(1000, 1800, 1, 0)).toBeGreaterThan(calculateElo(1000, 600, 1, 0));
  });
  it('no mezcla la cantidad de partidas entre clasificaciones', () => {
    const progress = noAwards();
    for (let i = 0; i < 80; i++)
      progress.matches[`online-${i}`] = {
        mode: 'online',
        difficulty: 0,
        metrics: {},
        completedAt: AT,
        result: 1,
      };
    const result = evaluate(match('machine', 'tactical'), progress);
    expect(result.progress.ratings).toEqual({ machine: 1020, online: 1000 });
  });
  it('muestra victorias, tablas y derrotas y restringe la ventana a 30 días naturales', () => {
    const progress = createPlayerProgression();
    const add = (id: string, result: 0 | 0.5 | 1) => {
      progress.matches[id] = {
        mode: 'machine',
        difficulty: 1,
        metrics: {},
        result,
        opponentRating: 1000,
        completedAt: id,
      };
    };
    add('2026-09-07T12:00:00.000Z', 1);
    add('2026-09-08T12:00:00.000Z', 0);
    add('2026-10-07T12:00:00.000Z', 0.5);
    expect(rankingSummary(progress, 'machine', 'all', AT)).toMatchObject({
      played: 3,
      wins: 1,
      draws: 1,
      losses: 1,
    });
    expect(rankingSummary(progress, 'machine', 'month', AT)).toMatchObject({
      played: 2,
      wins: 0,
      draws: 1,
      losses: 1,
    });
    expect(rankingSummary(progress, 'online', 'all', AT).played).toBe(0);
  });
  it('tolera datos corruptos y conserva registros antiguos sin inventar dificultad', () => {
    expect(parsePlayerProgression('{')).toEqual(createPlayerProgression());
    const parsed = parsePlayerProgression(
      JSON.stringify({
        version: 1,
        xp: -1,
        ratings: { machine: -5 },
        unlockedAt: { 'p1-01': 'bad', unknown: AT },
        matches: { bad: { mode: 'machine', metrics: {} } },
      }),
    );
    expect(parsed).toEqual(createPlayerProgression());
    const legacy = createAchievementProgress();
    legacy.unlockedAt['first-win'] = AT;
    legacy.counters.wins = 100;
    const migrated = migrateProgression(legacy);
    expect(migrated.legacyUnlockedAt['first-win']).toBe(AT);
    expect(migrated.xp).toBe(0);
    expect(progressionValue(migrated, definition('p2-03'))).toBe(0);
  });
});

describe('resumen de recompensas de batalla', () => {
  it('guarda XP, logros y Elo y no los duplica al evaluar de nuevo', () => {
    const record = match('machine', 'commander', 4);
    const before = createPlayerProgression();
    before.xp = 120;
    const update = evaluate(record, before);
    const battle = update.progress.matches[record.createdAt].battle!;
    expect(battle.xpBefore).toBe(120);
    expect(battle.xpAfter).toBe(update.progress.xp);
    expect(battle.rewards.reduce((sum, reward) => sum + reward.xp, 0)).toBe(update.xpEarned);
    expect(battle.rewards).toEqual(
      expect.arrayContaining([
        { label: 'Victoria contra Hexfortia', xp: 75 },
        { label: 'Primera partida del día', xp: 25 },
        { label: 'Turnos jugados', xp: 1 },
      ]),
    );
    expect(
      battle.rewards.filter((reward) => reward.achievementId).map((reward) => reward.achievementId),
    ).toEqual(update.unlocked);
    expect(battle.ratingBefore).toBe(1000);
    expect(battle.ratingAfter).toBe(update.progress.ratings.machine);
    expect(levelProgress(battle.xpAfter).level).toBeGreaterThan(
      levelProgress(battle.xpBefore).level,
    );
    expect(
      parsePlayerProgression(JSON.stringify(update.progress)).matches[record.createdAt].battle,
    ).toEqual(battle);
    expect(
      evaluateProgressionMatch(update.progress, record, { source: 'live', at: AT }).progress,
    ).toBe(update.progress);
  });
  it('conserva logros obtenidos antes del último turno', () => {
    let record = fixture([
      { id: 'soldier', type: 'soldier', owner: 0, facing: 0, position: { q: 0, r: 0 } },
    ]);
    record = appendAction(record, { kind: 'rotate', pieceId: 'soldier', facing: 1 });
    const during = evaluate(record);
    expect(during.unlocked.length).toBeGreaterThan(0);
    const finished = concludeMatch(record, { type: 'win', winner: 0, reason: 'resignation' });
    const result = evaluateProgressionMatch(during.progress, finished, { source: 'live', at: AT });
    const rewards = result.progress.matches[record.createdAt].battle!.rewards;
    for (const id of during.unlocked)
      expect(rewards.filter((reward) => reward.achievementId === id)).toHaveLength(1);
    expect(rewards.reduce((sum, reward) => sum + reward.xp, 0)).toBe(
      during.xpEarned + result.xpEarned,
    );
  });
  it('tolera registros antiguos sin desglose y descarta recibos malformados', () => {
    const update = evaluate(match());
    const id = Object.keys(update.progress.matches)[0];
    delete update.progress.matches[id].battle;
    expect(
      parsePlayerProgression(JSON.stringify(update.progress)).matches[id].battle,
    ).toBeUndefined();
    const raw = JSON.parse(JSON.stringify(update.progress));
    raw.matches[id].battle = { xpBefore: -1, xpAfter: 'bad', rewards: [] };
    expect(parsePlayerProgression(JSON.stringify(raw)).matches[id].battle).toBeUndefined();
  });
});
