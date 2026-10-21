import {
  CloudError,
  createAccountClient,
  type AccountClient,
  type AccountUser,
} from './account-client.js';
import type { CloudSave, PlayerData } from './cloud-contracts.js';
import { parsePlayerProgression } from './progression.js';
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
  let active = false;
  let lifecycle = 0;
  let epoch = 0;
  let revision = 0;
  let dirty = false;
  let changes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abort = new AbortController();
  let saving: Promise<void> | null = null;
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
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (snapshot.sync !== 'conflict')
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
  async function flush(): Promise<void> {
    if (!client || !snapshot.user || !snapshot.ready || !dirty || snapshot.sync === 'conflict')
      return;
    if (saving) return saving;
    const userId = snapshot.user.id,
      token = epoch,
      sentChanges = changes;
    update({ sync: 'saving', syncError: null });
    const operation = (async () => {
      await Promise.resolve();
      try {
        const result = await client.cloud(
          userId,
          { kind: 'save', revision, data: readPlayerData(userId) },
          abort.signal,
        );
        if (!active || token !== epoch) return;
        revision = result.revision;
        dirty = changes !== sentChanges;
        writeMeta(userId, { revision, dirty });
        update({ sync: dirty ? 'pending' : 'saved', syncError: null });
      } catch (error) {
        if (!active || token !== epoch) return;
        update({
          sync: error instanceof CloudError && error.status === 409 ? 'conflict' : 'offline',
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
      remote = result;
      revision = result.revision;
      if (cached?.dirty && cached.revision !== result.revision) {
        revision = cached.revision;
        dirty = true;
        update({
          ready: true,
          sync: 'conflict',
          syncError:
            'Hay progreso pendiente en este dispositivo y cambios en la nube. Elige qué copia conservar.',
        });
        return;
      }
      let importGuest = false;
      try {
        importGuest = localStorage.getItem('hexfortia:import-guest') === user.email.toLowerCase();
      } catch {
        /* Optional import. */
      }
      const data = cached?.dirty
        ? withElo(readPlayerData(user.id), result.elo)
        : importGuest && result.revision === 0
          ? withElo(readPlayerData(null), result.elo)
          : result.data;
      replacePlayerData(user.id, data);
      dirty = Boolean(cached?.dirty || (importGuest && result.revision === 0));
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
    bindSession(dispose: () => void) {
      beforeSwitch = dispose;
      return () => {
        if (beforeSwitch === dispose) beforeSwitch = null;
      };
    },
    start() {
      const life = ++lifecycle;
      active = true;
      unsubscribeStorage = onPlayerStorageChange(markDirty);
      const onOnline = () => {
        if (snapshot.sync === 'offline') retry();
      };
      if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
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
        if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
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
    signUp(email: string, password: string, importGuest: boolean) {
      return authTask(async () => {
        if (!client) return;
        if (importGuest) localStorage.setItem('hexfortia:import-guest', email.trim().toLowerCase());
        else localStorage.removeItem('hexfortia:import-guest');
        if (await client.signUp(email.trim(), password))
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
        remote = await client.cloud(userId, { kind: 'load' }, abort.signal);
        if (!active || token !== epoch) return;
        beforeSwitch?.();
        revision = remote.revision;
        if (choice === 'cloud') replacePlayerData(userId, remote.data);
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
            syncError: error instanceof Error ? error.message : 'No se pudo recuperar el guardado.',
          });
      }
    },
  };
}
export type AccountController = ReturnType<typeof createAccountController>;
