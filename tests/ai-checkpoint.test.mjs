import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeJsonCheckpoint } from '../scripts/ai/shared.mjs';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const directories = [];
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function checkpoint() {
  const directory = await mkdtemp(join(tmpdir(), 'hex-checkpoint-'));
  directories.push(directory);
  const path = join(directory, 'progress.json');
  await writeFile(path, JSON.stringify({ status: 'previous' }));
  return path;
}

it.each(['EPERM', 'EACCES', 'EBUSY'])(
  'retries a temporary %s lock without losing the checkpoint',
  async (code) => {
    const path = await checkpoint();
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('locked'), { code }));
    await writeJsonCheckpoint(path, { status: 'complete' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ status: 'complete' });
    expect(rename).toHaveBeenCalledTimes(2);
    await expect(readFile(`${path}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('propagates permanent failures and preserves the previous checkpoint', async () => {
  const path = await checkpoint();
  const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  vi.mocked(rename).mockRejectedValueOnce(failure);
  await expect(writeJsonCheckpoint(path, { status: 'complete' })).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ status: 'previous' });
});

it('bounds retries when a checkpoint remains locked', async () => {
  const path = await checkpoint();
  const failure = Object.assign(new Error('locked'), { code: 'EPERM' });
  for (let attempt = 0; attempt < 5; attempt += 1) vi.mocked(rename).mockRejectedValueOnce(failure);
  await expect(writeJsonCheckpoint(path, { status: 'complete' })).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledTimes(5);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ status: 'previous' });
});
