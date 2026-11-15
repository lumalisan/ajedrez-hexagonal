import {
  CloudError,
  createAccountClient,
  type AccountClient,
  type AccountUser,
} from './account-client.js';
import {
  MATCH_DATA_KEYS,
  PLAYER_DATA_KEYS,
  type CloudSave,
  type PlayerData,
} from './cloud-contracts.js';
import { parsePlayerProgression } from './progression.js';
import { validateUsername } from './username.js';
import { normalizeProfile } from './user-profile.js';
import {
  onPlayerStorageChange,
  readPlayerData,
  replacePlayerData,
  setPlayerStorageScope,
} from './player-storage.js';

type AccountDialog = 'signin' | 'signup' | 'recover' | 'password' | null;
export interface AccountSnapshot {
  available: boolean;
  ready: boolean;
  user: AccountUser | null;
  generation: number;
  dialog: AccountDialog;
  busy: boolean;
  error: string | null;
  message: string | null;
  sync: 'local' | 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'conflict';
  syncError: string | null;
}
interface SaveMeta {
  revision: number;
  dirty: boolean;
}
const metaKey = (id: string) => `hexfortia:cloud-meta:${id}`;
function readMeta(id: string): SaveMeta | null {
  try {
    const value = JSON.parse(localStorage.getItem(metaKey(id)) ?? 'null');
    return value && Number.isSafeInteger(value.revision) && typeof value.dirty === 'boolean'
      ? value
      : null;
  } catch {
    return null;
  }
}
function writeMeta(id: string, meta: SaveMeta) {
  localStorage.setItem(metaKey(id), JSON.stringify(meta));
}
function withElo(data: PlayerData, elo: number): PlayerData {
  const raw = data['hexagonal:progression:v1'];
  if (!raw) return data;
  const progress = parsePlayerProgression(raw);
  progress.ratings.online = elo;
  return { ...data, 'hexagonal:progression:v1': JSON.stringify(progress) };
}

function importGuestData(remote: CloudSave): PlayerData {
  const guest = withElo(readPlayerData(null), remote.elo);
  const data = { ...guest, ...remote.data };
  const key = 'hexagonal:user-profile:v1';
  if (guest[key] && remote.data[key]) {
    try {
      const reserved = normalizeProfile(JSON.parse(remote.data[key]), {
        name: 'Invitado',
        emblem: 'fortress',
        color: 'cyan',
      });
      data[key] = JSON.stringify({
        ...normalizeProfile(JSON.parse(guest[key]), reserved),
        name: reserved.name,
      });
    } catch {
      // An invalid guest profile cannot replace the registered identity.
    }
  }
  return data;
}

/** Coordinates identity and storage before a new GameSession is created. */
export function createAccountController(client: AccountClient | null = createAccountClient()) {
  let snapshot: AccountSnapshot = {
    available: Boolean(client),
    ready: !client,
    user: null,
    generation: 0,
    dialog: null,
    busy: false,
    error: null,
    message: null,
    sync: 'local',
    syncError: null,
  };
  const listeners = new Set<() => void>();
  let beforeSwitch: (() => void) | null = null;
  let progressChanged: (() => void) | undefined;
  let active = false;
  let lifecycle = 0;
  let epoch = 0;
  let revision = 0;
  let dirty = false;
  let changes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort = new AbortController();
  let saving: Promise<void> | null = null;
  let refreshing = false;
  let remote: CloudSave | null = null;
  let unsubscribeAuth: (() => void) | undefined;
  let unsubscribeStorage: (() => void) | undefined;

  function update(patch: Partial<AccountSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function cancelWork() {
    if (timer) clearTimeout(timer);
    timer = null;
    abort.abort();
    abort = new AbortController();
    saving = null;
    refreshing = false;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 1000);
  }
  function retry() {
    if (!snapshot.user) return;
    if (snapshot.ready && dirty && snapshot.sync !== 'conflict') {
      void flush();
      return;
    }
    if (snapshot.sync === 'conflict') return;
    if (snapshot.ready) {
      void refresh();
      return;
    }
    const user = snapshot.user;
    update({ ready: false, sync: 'offline' });
    void activate(user);
  }
  function markDirty(id: string) {
    if (snapshot.user?.id !== id) return;
    dirty = true;
    changes++;
    try {
      writeMeta(id, { revision, dirty });
    } catch {
      /* Save status reports local/cache failures on upload. */
    }
    if (snapshot.sync !== 'conflict') update({ sync: 'pending' });
    schedule();
  }
  function applyData(id: string, data: PlayerData) {
    const previous = readPlayerData(id);
    if (PLAYER_DATA_KEYS.every((key) => previous[key] === data[key])) return;
    replacePlayerData(id, data);
    progressChanged?.();
  }
  function acceptSave(id: string, result: CloudSave, data: PlayerData, conflict = false) {
    remote = result;
    if (!conflict) revision = result.revision;
    dirty = PLAYER_DATA_KEYS.some((key) => result.data[key] !== data[key]);
    applyData(id, data);
    writeMeta(id, { revision, dirty });
    update({
      ready: true,
      sync: conflict ? 'conflict' : dirty ? 'pending' : 'saved',
      syncError: conflict
        ? 'Tu progreso se ha sincronizado. Hay otros cambios en este dispositivo y en la nube.'
        : null,
    });
    if (dirty && !conflict) schedule();
  }
  async function mergePending(id: string, token: number, base: CloudSave | null) {
    if (!client) return;
    // Local play can advance while the network request runs. Upload the newer progress too.
    for (let attempt = 0; attempt < 3; attempt++) {
      const sent = readPlayerData(id);
      const matchData: PlayerData = {};
      for (const key of MATCH_DATA_KEYS) matchData[key] = sent[key];
      const result = await client.cloud(
        id,
        { kind: 'merge-progress', data: matchData },
        abort.signal,
      );
      if (!active || token !== epoch) return;
      const local = readPlayerData(id);
      if (MATCH_DATA_KEYS.some((key) => local[key] !== sent[key])) continue;
      const data = { ...result.data };
      let conflict = false;
      for (const key of PLAYER_DATA_KEYS) {
        if ((MATCH_DATA_KEYS as readonly string[]).includes(key) || local[key] === data[key])
          continue;
        // The pending list preserves battles from both devices. Keep the cloud's active pointer.
        if (key === 'atlas-match-classic-v2') continue;
        if (base && local[key] === base.data[key]) continue;
        if (!base && local[key] === undefined) continue;
        conflict ||= !base || data[key] !== base.data[key];
        data[key] = local[key];
      }
      acceptSave(id, result, data, conflict);
      return result;
    }
    // Every response committed a merge. Keep the newer local edits pending for the next upload.
    update({ ready: true, sync: 'pending', syncError: null });
    schedule();
  }
  async function refresh(): Promise<void> {
    if (!client || !snapshot.user || !snapshot.ready || dirty || saving || refreshing) return;
    const id = snapshot.user.id;
    const token = epoch;
    const started = changes;
    refreshing = true;
    try {
      const result = await client.cloud(id, { kind: 'load' }, abort.signal);
      if (active && token === epoch && changes === started && !dirty)
        acceptSave(id, result, result.data);
    } catch (error) {
      if (active && token === epoch && changes === started)
        update({ sync: 'offline', syncError: error instanceof Error ? error.message : null });
    } finally {
      if (token === epoch) refreshing = false;
    }
  }
  async function flush(): Promise<void> {
    if (!client || !snapshot.user || !snapshot.ready || !dirty) return;
    if (saving) return saving;
    const userId = snapshot.user.id;
    const token = epoch;
    const conflicting = snapshot.sync === 'conflict';
    if (!conflicting) update({ sync: 'saving', syncError: null });
    const operation = (async () => {
      await Promise.resolve();
      try {
        if (!active || token !== epoch) return;
        if (conflicting) {
          await mergePending(userId, token, null);
          return;
        }
        const sent = readPlayerData(userId);
        try {
          const result = await client.cloud(
            userId,
            { kind: 'save', revision, data: sent },
            abort.signal,
          );
          if (!active || token !== epoch) return;
          const local = readPlayerData(userId);
          const data = { ...result.data };
          for (const key of PLAYER_DATA_KEYS) if (sent[key] !== local[key]) data[key] = local[key];
          acceptSave(userId, result, data);
        } catch (error) {
          if (!(error instanceof CloudError) || error.status !== 409) throw error;
          if (active && token === epoch) await mergePending(userId, token, remote);
        }
      } catch (error) {
        if (!active || token !== epoch) return;
        update({
          sync: conflicting ? 'conflict' : 'offline',
          syncError:
            error instanceof Error
              ? error.message
              : 'No se pudo guardar en la nube. Tu copia local se conserva.',
        });
      } finally {
        if (token === epoch) {
          saving = null;
          if (dirty && snapshot.sync === 'pending') schedule();
        }
      }
    })();
    saving = operation;
    return operation;
  }
  async function activate(user: AccountUser | null, recovery = false) {
    if (!active) return;
    if (recovery) update({ dialog: 'password', message: null, error: null });
    if (snapshot.ready && snapshot.user?.id === user?.id) return;
    // Duplicate INITIAL_SESSION/SIGNED_IN events share the same hydration.
    if (!snapshot.ready && snapshot.user?.id === user?.id && snapshot.sync === 'loading') return;
    beforeSwitch?.();
    const token = ++epoch;
    cancelWork();
    revision = 0;
    dirty = false;
    changes = 0;
    remote = null;
    setPlayerStorageScope(user?.id ?? null);
    update({
      user,
      ready: !user,
      sync: user ? 'loading' : 'local',
      syncError: null,
      generation: snapshot.generation + 1,
      dialog: recovery ? 'password' : null,
    });
    if (!user || !client) return;
    const cached = readMeta(user.id);
    try {
      const result = await client.cloud(user.id, { kind: 'load' }, abort.signal);
      if (!active || token !== epoch) return;
      if (cached?.dirty && cached.revision !== result.revision) {
        revision = cached.revision;
        dirty = true;
        await mergePending(user.id, token, null);
        return;
      }
      remote = result;
      revision = result.revision;
      let importGuest = false;
      try {
        importGuest = localStorage.getItem('hexfortia:import-guest') === user.email.toLowerCase();
      } catch {
        /* Optional import. */
      }
      const importing =
        importGuest &&
        (result.revision === 0 ||
          (result.revision === 1 &&
            Object.keys(result.data).length === 1 &&
            Boolean(result.data['hexagonal:user-profile:v1'])));
      const data = cached?.dirty
        ? withElo(readPlayerData(user.id), result.elo)
        : importing
          ? importGuestData(result)
          : result.data;
      replacePlayerData(user.id, data);
      dirty = Boolean(cached?.dirty || importing);
      writeMeta(user.id, { revision, dirty });
      try {
        localStorage.removeItem('hexfortia:import-guest');
      } catch {
        /* No cloud content is removed. */
      }
      update({ ready: true, sync: dirty ? 'pending' : 'saved', syncError: null });
      if (dirty) schedule();
    } catch (error) {
      if (!active || token !== epoch) return;
      revision = cached?.revision ?? 0;
      dirty = cached?.dirty ?? false;
      update({
        ready: Boolean(cached),
        sync: 'offline',
        syncError: error instanceof Error ? error.message : 'No se pudo cargar el progreso.',
      });
    }
  }
  async function authTask(work: () => Promise<void>) {
    if (snapshot.busy) return;
    update({ busy: true, error: null, message: null });
    try {
      await work();
    } catch (error) {
      if (active)
        update({
          error: error instanceof Error ? error.message : 'No se pudo completar la operación.',
        });
    } finally {
      if (active) update({ busy: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bindSession(dispose: () => void, syncProgress?: () => void) {
      beforeSwitch = dispose;
      progressChanged = syncProgress;
      return () => {
        if (beforeSwitch === dispose) {
          beforeSwitch = null;
          progressChanged = undefined;
        }
      };
    },
    start() {
      const life = ++lifecycle;
      active = true;
      unsubscribeStorage = onPlayerStorageChange(markDirty);
      const onOnline = () => {
        if (snapshot.sync === 'offline') retry();
        else void refresh();
      };
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        if (snapshot.sync === 'offline') retry();
        else if (snapshot.sync === 'conflict') void flush();
        else void refresh();
      };
      let foregroundTimer: ReturnType<typeof setInterval> | undefined;
      if (typeof window !== 'undefined' && client) {
        window.addEventListener('online', onOnline);
        window.addEventListener('focus', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        foregroundTimer = setInterval(onVisible, 30_000);
      }
      if (client)
        void client
          .watch((user, recovery) => {
            if (active && life === lifecycle) void activate(user, recovery);
          })
          .then((unsubscribe) => {
            if (active && life === lifecycle) unsubscribeAuth = unsubscribe;
            else unsubscribe();
          })
          .catch(() => {
            if (active && life === lifecycle && !snapshot.user) {
              setPlayerStorageScope(null);
              update({ ready: true, sync: 'local' });
            }
          });
      else setPlayerStorageScope(null);
      return () => {
        if (life !== lifecycle) return;
        active = false;
        lifecycle++;
        epoch++;
        cancelWork();
        unsubscribeAuth?.();
        unsubscribeStorage?.();
        if (foregroundTimer !== undefined) {
          clearInterval(foregroundTimer);
          window.removeEventListener('online', onOnline);
          window.removeEventListener('focus', onVisible);
          document.removeEventListener('visibilitychange', onVisible);
        }
      };
    },
    open(dialog: AccountDialog = 'signin') {
      update({ dialog, error: null, message: null });
    },
    close() {
      update({ dialog: null, error: null, message: null });
    },
    signIn(email: string, password: string) {
      return authTask(async () => {
        if (client) await client.signIn(email.trim(), password);
      });
    },
    async username(value: string) {
      const name = validateUsername(value);
      const token = epoch;
      if (client) await client.username(name, Boolean(snapshot.user));
      if (token !== epoch || !active) throw new Error('La sesión ha cambiado. Inténtalo de nuevo.');
      return name;
    },
    signUp(email: string, password: string, importGuest: boolean, username: string) {
      return authTask(async () => {
        if (!client) return;
        const name = validateUsername(username);
        await client.username(name, false);
        if (importGuest) localStorage.setItem('hexfortia:import-guest', email.trim().toLowerCase());
        else localStorage.removeItem('hexfortia:import-guest');
        if (await client.signUp(email.trim(), password, name))
          update({
            message: 'Revisa tu correo para confirmar la cuenta. Después podrás iniciar sesión.',
          });
      });
    },
    signOut() {
      return authTask(async () => {
        beforeSwitch?.();
        await flush();
        // Disposing the session can add a final save while another upload is in flight.
        if (dirty && snapshot.sync === 'pending') await flush();
        try {
          if (client) await client.signOut();
        } catch (error) {
          update({ generation: snapshot.generation + 1 });
          throw error;
        }
      });
    },
    deleteAccount() {
      return authTask(async () => {
        if (!client || !snapshot.user) return;
        const userId = snapshot.user.id;
        beforeSwitch?.();
        const pendingSave = saving;
        epoch++;
        cancelWork();
        if (pendingSave) await pendingSave;
        try {
          await client.deleteAccount();
        } catch (error) {
          update({ generation: snapshot.generation + 1 });
          if (dirty) schedule();
          throw error;
        }
        replacePlayerData(userId, {});
        localStorage.removeItem(metaKey(userId));
        await activate(null);
      });
    },
    recover(email: string) {
      return authTask(async () => {
        if (client) await client.recover(email.trim());
        update({
          message:
            'Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña.',
        });
      });
    },
    password(password: string) {
      return authTask(async () => {
        if (client) await client.password(password);
        update({ dialog: null });
      });
    },
    retry,
    async resolveConflict(choice: 'cloud' | 'device') {
      if (!snapshot.user || !client) return;
      const token = epoch,
        userId = snapshot.user.id;
      try {
        await saving;
        if (!active || token !== epoch) return;
        beforeSwitch?.();
        if (timer) clearTimeout(timer);
        timer = null;
        const result = await mergePending(userId, token, null);
        if (!active || token !== epoch) return;
        if (!result) {
          update({ generation: snapshot.generation + 1 });
          return;
        }
        revision = result.revision;
        const data = choice === 'cloud' ? result.data : readPlayerData(userId);
        for (const key of MATCH_DATA_KEYS) data[key] = result.data[key];
        replacePlayerData(userId, data);
        dirty = choice === 'device';
        writeMeta(userId, { revision, dirty });
        update({
          ready: true,
          generation: snapshot.generation + 1,
          sync: dirty ? 'pending' : 'saved',
          syncError: null,
        });
        if (dirty) await flush();
      } catch (error) {
        if (active && token === epoch)
          update({
            generation: snapshot.generation + 1,
            syncError: error instanceof Error ? error.message : 'No se pudo recuperar el guardado.',
          });
      }
    },
  };
}
export type AccountController = ReturnType<typeof createAccountController>;
