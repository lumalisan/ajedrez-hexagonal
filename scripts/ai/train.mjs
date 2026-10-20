import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = process.env.AI_PYTHON || 'python';
const args = process.argv.slice(2);
const selfTest = args[0] === '--self-test';
const child = spawn(
  python,
  [
    '-B',
    fileURLToPath(new URL(selfTest ? './test_train.py' : './train.py', import.meta.url)),
    ...(selfTest ? args.slice(1) : args),
  ],
  { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } },
);
child.on('error', (error) => {
  console.error(`No se pudo ejecutar Python: ${error.message}. Configura AI_PYTHON.`);
  process.exitCode = 1;
});
const stop = () => child.kill();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.on('exit', (code) => {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  process.exitCode = code ?? 1;
});
