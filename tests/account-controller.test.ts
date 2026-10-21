import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountController, type AccountController } from '../src/account-controller';
import { CloudError, type AccountClient, type AccountUser } from '../src/account-client';
import type { CloudSave } from '../src/cloud-contracts';
import { playerStorage, setPlayerStorageScope } from '../src/player-storage';
import { installMemoryStorage } from './helpers/memory-storage';

const a = { id: 'account-a', email: 'a@example.test' };
const b = { id: 'account-b', email: 'b@example.test' };
const key = 'hexagonal:user-profile:v1';
let controllers: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  installMemoryStorage();
  setPlayerStorageScope(null);
});
afterEach(() => {
  controllers.forEach((stop) => stop());
  controllers = [];
  setPlayerStorageScope(null);
  vi.useRealTimers();
});

function setup() {
  let listener: (user: AccountUser | null) => void = () => {};
  const saves = new Map<string, CloudSave>();
  const client: AccountClient = {
    watch: vi.fn(async (callback) => {
      listener = callback;
      callback(null);
      return vi.fn();
    }),
    signIn: vi.fn(async () => {
      listener(a);
    }),
    signUp: vi.fn(async () => true),
    signOut: vi.fn(async () => {
      listener(null);
    }),
    recover: vi.fn(async () => {}),
    password: vi.fn(async () => {}),
    cloud: vi.fn(async (id, request) => {
      const current = saves.get(id) ?? { revision: 0, data: {}, elo: 1000 };
      if (request.kind === 'load') return structuredClone(current);
      if (request.revision !== current.revision) throw new CloudError('Conflicto', 409);
      const next = { revision: current.revision + 1, data: request.data, elo: 1000 };
      saves.set(id, structuredClone(next));
      return next;
    }),
  };
  const controller = createAccountController(client);
  controllers.push(controller.start());
  return { client, saves, controller, identify: (user: AccountUser | null) => listener(user) };
}
const tick = () => vi.advanceTimersByTimeAsync(0);
async function signIn(controller: AccountController) {
  await controller.signIn(a.email, 'password');
  await tick();
}

describe('cuentas, caché por identidad y sincronización', () => {
  it('conserva al invitado y aísla los datos de dos cuentas al entrar y salir', async () => {
    localStorage.setItem(key, '{"name":"Invitado"}');
    const { controller, identify } = setup();
    const dispose = vi.fn();
    controller.bindSession(dispose);
    await signIn(controller);
    expect(playerStorage.getItem(key)).toBeNull();
    playerStorage.setItem(key, '{"name":"A"}');
    await vi.advanceTimersByTimeAsync(1100);
    identify(b);
    await tick();
    expect(playerStorage.getItem(key)).toBeNull();
    playerStorage.setItem(key, '{"name":"B"}');
    await vi.advanceTimersByTimeAsync(1100);
    identify(a);
    await tick();
    expect(playerStorage.getItem(key)).toBe('{"name":"A"}');
    await controller.signOut();
    await tick();
    expect(playerStorage.getItem(key)).toBe('{"name":"Invitado"}');
    expect(dispose).toHaveBeenCalled();
  });
  it('importa el progreso local elegido al registrarse sin borrar el guardado invitado', async () => {
    localStorage.setItem(key, '{"name":"Invitado"}');
    const { controller, identify, saves } = setup();
    await controller.signUp(a.email, 'password', true);
    expect(controller.getSnapshot().message).toContain('confirmar');
    identify(a);
    await tick();
    expect(playerStorage.getItem(key)).toBe('{"name":"Invitado"}');
    await vi.advanceTimersByTimeAsync(1100);
    expect(saves.get(a.id)?.data[key]).toBe('{"name":"Invitado"}');
    expect(localStorage.getItem(key)).toBe('{"name":"Invitado"}');
  });
  it('un registro repetido nunca sustituye el progreso ya existente de la cuenta', async () => {
    localStorage.setItem(key, '{"name":"Invitado"}');
    const { controller, identify, saves } = setup();
    saves.set(a.id, { revision: 4, data: { [key]: '{"name":"Nube"}' }, elo: 1000 });
    await controller.signUp(a.email, 'password', true);
    identify(a);
    await tick();
    expect(playerStorage.getItem(key)).toBe('{"name":"Nube"}');
  });
  it('resuelve conflictos de dispositivos explícitamente y mantiene la revisión pendiente al recargar', async () => {
    const { controller, saves, identify } = setup();
    await signIn(controller);
    saves.set(a.id, { revision: 2, data: { [key]: '{"name":"Otro dispositivo"}' }, elo: 1000 });
    playerStorage.setItem(key, '{"name":"Este dispositivo"}');
    await vi.advanceTimersByTimeAsync(1100);
    expect(controller.getSnapshot().sync).toBe('conflict');
    identify(null);
    await tick();
    identify(a);
    await tick();
    expect(controller.getSnapshot().sync).toBe('conflict');
    playerStorage.setItem(key, '{"name":"Pendiente"}');
    expect(JSON.parse(localStorage.getItem('hexfortia:cloud-meta:account-a')!).revision).toBe(0);
    await controller.resolveConflict('cloud');
    expect(playerStorage.getItem(key)).toBe('{"name":"Otro dispositivo"}');
    expect(controller.getSnapshot().sync).toBe('saved');
  });
  it('conserva el progreso pendiente si falla la red y lo guarda al reintentar', async () => {
    const { client, controller, saves } = setup();
    await signIn(controller);
    vi.mocked(client.cloud).mockRejectedValueOnce(new Error('Sin conexión'));
    playerStorage.setItem(key, '{"name":"Pendiente"}');
    await vi.advanceTimersByTimeAsync(1100);
    expect(controller.getSnapshot().sync).toBe('offline');
    expect(JSON.parse(localStorage.getItem('hexfortia:cloud-meta:account-a')!).dirty).toBe(true);
    controller.retry();
    await tick();
    expect(saves.get(a.id)?.data[key]).toBe('{"name":"Pendiente"}');
    expect(controller.getSnapshot().sync).toBe('saved');
  });
  it('un error inicial sin copia local no crea un progreso vacío que sobreescriba la nube', async () => {
    const { client, controller } = setup();
    vi.mocked(client.cloud).mockRejectedValueOnce(new Error('Sin conexión'));
    await signIn(controller);
    expect(controller.getSnapshot().ready).toBe(false);
    controller.retry();
    await tick();
    expect(controller.getSnapshot().ready).toBe(true);
    expect(vi.mocked(client.cloud).mock.calls.every(([, request]) => request.kind === 'load')).toBe(
      true,
    );
  });
  it('ignora una carga tardía de otra identidad sin alterar el perfil activo', async () => {
    const { client, controller, identify, saves } = setup();
    let release!: (save: CloudSave) => void;
    vi.mocked(client.cloud).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    identify(a);
    saves.set(b.id, { revision: 1, data: { [key]: '{"name":"B"}' }, elo: 1000 });
    identify(b);
    await tick();
    release({ revision: 1, data: { [key]: '{"name":"A tardío"}' }, elo: 1000 });
    await tick();
    expect(controller.getSnapshot().user?.id).toBe(b.id);
    expect(playerStorage.getItem(key)).toBe('{"name":"B"}');
  });
  it('guarda el último estado al salir aunque ya haya una subida en curso', async () => {
    const { client, controller, saves } = setup();
    await signIn(controller);
    const cloud = client.cloud;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = vi.mocked(cloud).getMockImplementation()!;
    vi.mocked(cloud).mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });
    playerStorage.setItem(key, '{"name":"Primera subida"}');
    await vi.advanceTimersByTimeAsync(1100);
    controller.bindSession(() => playerStorage.setItem(key, '{"name":"Último estado"}'));
    const exit = controller.signOut();
    release();
    await exit;
    await tick();
    expect(saves.get(a.id)?.data[key]).toBe('{"name":"Último estado"}');
    expect(controller.getSnapshot().user).toBeNull();
    expect(playerStorage.getItem(key)).toBeNull();
  });
});
