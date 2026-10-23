import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function fileDigest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export async function researchFingerprint(root) {
  const files = ['package.json', 'pnpm-lock.yaml', 'tests/fixtures/ai-strategic-positions.json'];
  for (const folder of ['src', 'scripts/ai']) {
    for (const path of await readdir(resolve(root, folder), { recursive: true })) {
      if (/\.(ts|tsx|mjs|py|js)$/.test(path)) files.push(`${folder}/${path}`);
    }
  }
  const digest = createHash('sha256');
  for (const path of files.sort())
    digest.update(path).update(await fileDigest(resolve(root, path)));
  return digest.digest('hex');
}

/** Serialize lock acquisition/recovery too, so concurrent resumers cannot steal a new lock. */
export async function acquireResearchLock(path, resume = false) {
  const guardPath = `${path}.guard`;
  let guard;
  try {
    guard = await open(guardPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Otra operación está adquiriendo el bloqueo: ${guardPath}. Si quedó huérfano, comprueba su PID antes de retirarlo.`,
        { cause: error },
      );
    throw error;
  }
  const token = randomUUID();
  let lock;
  try {
    await guard.writeFile(JSON.stringify({ pid: process.pid, token }));
    try {
      lock = await open(path, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(path, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
        throw new Error(`Bloqueo sin PID válido: ${path}.`, { cause: error });
      let alive = true;
      try {
        process.kill(previous.pid, 0);
      } catch (checkError) {
        if (checkError.code === 'ESRCH') alive = false;
        else
          throw new Error(`No se puede verificar el PID ${previous.pid}: ${checkError.message}`, {
            cause: checkError,
          });
      }
      if (alive)
        throw new Error(`Ya hay un experimento activo (PID ${previous.pid}).`, { cause: error });
      if (!resume)
        throw new Error(`Bloqueo huérfano del PID ${previous.pid}; utiliza --resume.`, {
          cause: error,
        });
      await unlink(path);
      lock = await open(path, 'wx');
    }
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }),
    );
    await lock.close();
    lock = undefined;
  } finally {
    await lock?.close();
    await guard.close();
    await unlink(guardPath);
  }
  return async () => {
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (current.token !== token) throw new Error('El bloqueo cambió durante el experimento.');
    await unlink(path);
  };
}
