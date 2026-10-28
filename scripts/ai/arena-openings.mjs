import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const OPENING_SCOPES = new Set(['fullgame', 'midgame', 'endgame', 'midgame/endgame']);

function openingRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules))
    throw new Error('Cada apertura necesita sus reglas explícitas.');
  const known = ['repetition', 'noProgressPlyLimit', 'orientationOnlyTurnLimit'];
  if (Object.keys(rules).some((key) => !known.includes(key)))
    throw new Error('La apertura contiene una regla desconocida.');
  for (const key of known) {
    if (!(key in rules) && key === 'orientationOnlyTurnLimit') continue;
    if (rules[key] !== null && (!Number.isSafeInteger(rules[key]) || rules[key] < 1))
      throw new Error(`Regla inválida: ${key}.`);
  }
  return { ...rules };
}

/** Endgame certificates are provenance, never substitutes for engine replay or game outcomes. */
export function openingBookEntries(document) {
  if (document.format === 'hex-arena-openings-v1') {
    if (!Array.isArray(document.entries)) throw new Error('El libro no contiene entries.');
    return { scope: document.scope ?? 'midgame/endgame', entries: document.entries };
  }
  if (document.format === 'hex-engine-endgames-v1' && Array.isArray(document.cases)) {
    return {
      scope: 'endgame',
      entries: document.cases.map((entry) => ({
        id: entry.id,
        familyId: entry.family,
        seed: entry.seed,
        initialState: entry.state,
        actions: [],
        rules: entry.rules,
        scope: 'endgame',
        provenance: entry.provenance,
      })),
    };
  }
  throw new Error('Formato de libro de aperturas desconocido.');
}

export function reconstructBookOpening(engine, entry) {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    !entry.id.trim() ||
    typeof entry.familyId !== 'string' ||
    !entry.familyId.trim() ||
    !Number.isSafeInteger(entry.seed) ||
    entry.seed < 0 ||
    entry.seed > 0xffffffff
  )
    throw new Error('La apertura necesita id, familyId y semilla uint32 válidos.');
  if (!Array.isArray(entry.actions)) throw new Error(`Falta el prefijo legal: ${entry.id}.`);
  const rules = openingRules(entry.rules);
  if (
    !entry.initialState ||
    engine.validateState(entry.initialState).length ||
    entry.initialState.outcome
  )
    throw new Error(`Estado inicial inválido o terminal: ${entry.id}.`);
  const initialState = engine.cloneState(entry.initialState);
  let state = engine.cloneState(initialState);
  for (const [index, action] of entry.actions.entries()) {
    const result = engine.applyAction(state, action, rules);
    if (!result.ok) throw new Error(`Prefijo ilegal en ${entry.id}, orden ${index + 1}.`);
    state = result.state;
  }
  if (state.outcome) throw new Error(`El prefijo ya termina la partida: ${entry.id}.`);
  if (!engine.getAllLegalActions(state).length)
    throw new Error(`La apertura no tiene órdenes legales para el bando activo: ${entry.id}.`);
  if (entry.scope !== undefined && !OPENING_SCOPES.has(entry.scope))
    throw new Error(`Ámbito de apertura desconocido: ${entry.id}.`);
  return {
    id: entry.id,
    familyId: entry.familyId,
    ...(entry.drawId !== undefined ? { drawId: entry.drawId } : {}),
    seed: entry.seed,
    initialState,
    state,
    actions: structuredClone(entry.actions),
    rules,
    initialLayout: null,
    fortressHp: initialState.pieces
      .filter((piece) => piece.type === 'fortress')
      .sort((a, b) => a.owner - b.owner)
      .map((piece) => piece.hp),
    scope: entry.scope ?? 'midgame/endgame',
    provenance: entry.provenance ?? null,
  };
}

/** One deterministic member per family, never cycling variants to inflate the sample. */
export function prepareOpeningBook(engine, document, { pairs, seed, sha256, path = null }) {
  if (
    !Number.isSafeInteger(pairs) ||
    pairs < 1 ||
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  )
    throw new Error('Número de pares o semilla inválidos.');
  const parsed = openingBookEntries(document);
  const iid = document.samplingUnit === 'iid-draw';
  if (document.samplingUnit !== undefined && !iid)
    throw new Error('Unidad de muestreo desconocida.');
  if (
    iid &&
    (document.format !== 'hex-arena-openings-v1' ||
      document.role !== 'confirmation' ||
      document.samplingProtocol?.method !== 'iid-with-replacement' ||
      document.samplingProtocol?.conditionedOn !== 'nonterminal-and-fixed-exclusions' ||
      document.samplingProtocol?.modelFree !== true ||
      document.samplingProtocol?.duplicateFamilies !== 'retained')
  )
    throw new Error('El libro IID necesita un protocolo explícito de confirmación sin modelo.');
  if (!OPENING_SCOPES.has(parsed.scope))
    throw new Error('El ámbito del libro debe ser fullgame, midgame o endgame.');
  if (!parsed.entries.length) throw new Error('El libro está vacío.');
  const ids = new Set();
  const draws = new Set();
  const families = new Map();
  const all = parsed.entries.map((entry) => {
    if (ids.has(entry.id)) throw new Error(`ID de apertura duplicado: ${entry.id}.`);
    ids.add(entry.id);
    if (iid) {
      if (typeof entry.drawId !== 'string' || !entry.drawId.trim() || draws.has(entry.drawId))
        throw new Error('drawId vacío o duplicado en el libro IID.');
      draws.add(entry.drawId);
    }
    const opening = reconstructBookOpening(engine, {
      ...entry,
      scope: entry.scope ?? parsed.scope,
    });
    const group = families.get(opening.familyId) ?? [];
    group.push(opening);
    families.set(opening.familyId, group);
    return opening;
  });
  if (pairs > (iid ? all.length : families.size))
    throw new Error(
      iid
        ? `Se solicitaron ${pairs} pares, pero el libro solo contiene ${all.length} sorteos IID.`
        : `Se solicitaron ${pairs} pares, pero el libro solo tiene ${families.size} familias distintas; no se repiten variantes.`,
    );
  const selected = iid
    ? all.slice(0, pairs)
    : [...families.entries()].slice(0, pairs).map(([familyId, variants]) => {
        const variantIndex =
          createHash('sha256')
            .update(JSON.stringify([seed, familyId]))
            .digest()
            .readUInt32LE(0) % variants.length;
        return variants[variantIndex];
      });
  return {
    openings: selected,
    identity: {
      format: document.format,
      path,
      sha256: sha256 ?? digest(JSON.stringify(document)),
      scope: parsed.scope,
      totalEntries: all.length,
      totalFamilies: families.size,
      selectedPairs: pairs,
      selectionSeed: seed,
      ...(iid ? { samplingUnit: 'iid-draw', samplingProtocol: document.samplingProtocol } : {}),
      selection: iid
        ? 'Original draw order, fixed before playing. Keep all natural family repetitions; no family grouping, rotations or cycling.'
        : 'Book family order, one member selected by SHA-256(seed,familyId), fixed before playing. No family cycling and no inference of statistical independence.',
      selected: selected.map((entry) => ({
        id: entry.id,
        familyId: entry.familyId,
        ...(iid ? { drawId: entry.drawId } : {}),
        seed: entry.seed,
        rules: entry.rules,
        scope: entry.scope,
      })),
    },
  };
}

export async function loadOpeningBook(engine, path, settings) {
  const absolute = resolve(path);
  const text = await readFile(absolute, 'utf8');
  return prepareOpeningBook(engine, JSON.parse(text), {
    ...settings,
    path: absolute,
    sha256: digest(text),
  });
}

export function openingBookResumeMatches(previous, planned) {
  return isDeepStrictEqual(previous?.openingBook ?? null, planned?.openingBook ?? null);
}

/** Restore the saved path from its original state, including the prescribed prefix. */
export function restoreBookCheckpoint(engine, opening, partial) {
  if (!partial) return engine.cloneState(opening.state);
  if (
    !isDeepStrictEqual(partial.initialState, opening.initialState) ||
    !isDeepStrictEqual(partial.rules, opening.rules) ||
    !Array.isArray(partial.actions) ||
    partial.actions.length < opening.actions.length ||
    !isDeepStrictEqual(partial.actions.slice(0, opening.actions.length), opening.actions)
  )
    throw new Error('El checkpoint no conserva el estado, reglas o prefijo del libro.');
  let state = engine.cloneState(opening.initialState);
  for (const action of partial.actions) {
    const result = engine.applyAction(state, action, opening.rules);
    if (!result.ok) throw new Error('El checkpoint contiene una orden ilegal.');
    state = result.state;
  }
  if (!isDeepStrictEqual(state, partial.finalState))
    throw new Error('El estado final del checkpoint no coincide con sus órdenes legales.');
  return state;
}
