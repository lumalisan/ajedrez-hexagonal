import {
  PLAYER_DATA_KEYS,
  type CloudRequest,
  type CloudSave,
  type PlayerData,
} from '../src/cloud-contracts.js';
import { parsePlayerProgression } from '../src/progression.js';
import { OnlineError } from './online-service.js';
import type { OnlineRepository } from './repository.js';

export class AccountService {
  constructor(private readonly repository: OnlineRepository) {}
  async request(id: string, request: CloudRequest): Promise<CloudSave> {
    if (!request || !['load', 'save'].includes(request.kind))
      throw new OnlineError('Solicitud de cuenta no válida.');
    return this.repository.transaction(`account:${id}`, async (tx) => {
      const current = await tx.account(id);
      const elo = (await tx.player(id))?.elo ?? 1000;
      if (request.kind === 'load')
        return {
          revision: current?.revision ?? 0,
          data: normalizeData(current?.data ?? {}, elo),
          elo,
        };
      if (!Number.isSafeInteger(request.revision) || request.revision < 0)
        throw new OnlineError('Revisión no válida.');
      const data = normalizeData(request.data, elo);
      if (request.revision !== (current?.revision ?? 0))
        throw new OnlineError(
          'Hay cambios guardados desde otro dispositivo. Elige qué progreso conservar.',
          409,
        );
      const next = { revision: request.revision + 1, data };
      await tx.saveAccount(id, next);
      return { ...next, elo };
    });
  }
}

function normalizeData(value: unknown, elo: number): PlayerData {
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
    if (key === 'hexagonal:progression:v1') {
      const progress = parsePlayerProgression(raw);
      progress.ratings.online = elo;
      data[key] = JSON.stringify(progress);
    } else data[key as keyof PlayerData] = raw;
  }
  if (Buffer.byteLength(JSON.stringify(data)) > 3_000_000)
    throw new OnlineError('El guardado supera el tamaño admitido.', 413);
  return data;
}
