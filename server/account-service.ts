import {
  PLAYER_DATA_KEYS,
  type CloudRequest,
  type CloudSave,
  type PlayerData,
} from '../src/cloud-contracts.js';
import { parsePlayerProgression } from '../src/progression.js';
import { OnlineError } from './online-service.js';
import type { OnlineMatch, OnlineRepository } from './repository.js';
import { mergeCloudProgress } from './cloud-progress.js';
import { reconcileOnlineProgression } from './online-progression.js';

export class AccountService {
  constructor(private readonly repository: OnlineRepository) {}
  async request(id: string, request: CloudRequest): Promise<CloudSave> {
    if (!request || !['load', 'save', 'merge-progress'].includes(request.kind))
      throw new OnlineError('Solicitud de cuenta no válida.');
    return this.repository.transaction(`account:${id}`, async (tx) => {
      const current = await tx.account(id);
      const elo = (await tx.player(id))?.elo ?? 1000;
      const revision = current?.revision ?? 0;
      if (request.kind === 'load')
        return {
          revision,
          data: withOnlineProgress(
            normalizeData(current?.data ?? {}),
            await tx.settledMatches(id),
            id,
            elo,
          ),
          elo,
        };
      if (
        request.kind === 'save' &&
        (!Number.isSafeInteger(request.revision) || request.revision < 0)
      )
        throw new OnlineError('Revisión no válida.');
      if (request.kind === 'save' && request.revision !== revision)
        throw new OnlineError(
          'Hay cambios guardados desde otro dispositivo. Elige qué progreso conservar.',
          409,
        );
      const incoming = normalizeData(request.data);
      const saved = request.kind === 'merge-progress' ? normalizeData(current?.data ?? {}) : null;
      const combined = saved
        ? mergeCloudProgress(saved, incoming, new Date().toISOString())
        : incoming;
      const data = withOnlineProgress(combined, await tx.settledMatches(id), id, elo);
      if (saved && JSON.stringify(data) === JSON.stringify(saved)) return { revision, data, elo };
      checkSize(data);
      const next = { revision: revision + 1, data };
      await tx.saveAccount(id, next);
      return { ...next, elo };
    });
  }
}

function withOnlineProgress(data: PlayerData, matches: OnlineMatch[], id: string, elo: number) {
  const key = 'hexagonal:progression:v1';
  if (!matches.length && !data[key]) return data;
  const progress = reconcileOnlineProgression(
    parsePlayerProgression(data[key] ?? '{}'),
    matches,
    id,
  );
  progress.ratings.online = elo;
  return { ...data, [key]: JSON.stringify(progress) };
}

function normalizeData(value: unknown): PlayerData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OnlineError('Guardado no válido.');
  const data: PlayerData = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!(PLAYER_DATA_KEYS as readonly string[]).includes(key) || typeof raw !== 'string')
      throw new OnlineError('El guardado contiene datos no permitidos.');
    try {
      JSON.parse(raw);
    } catch {
      throw new OnlineError('El guardado contiene datos dañados.');
    }
    data[key as keyof PlayerData] = raw;
  }
  checkSize(data);
  return data;
}
function checkSize(data: PlayerData) {
  if (Buffer.byteLength(JSON.stringify(data)) > 3_000_000)
    throw new OnlineError('El guardado supera el tamaño admitido.', 413);
}
