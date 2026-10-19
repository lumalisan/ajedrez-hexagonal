import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { parseArguments, writeJsonCheckpoint } from './shared.mjs';

const options = parseArguments(process.argv.slice(2), {
  model: { type: 'string', default: 'src/ai-models/hex-value.bin' },
  output: { type: 'string', default: '.ai-lab/browser.json' },
});
const root = process.cwd();
const model = resolve(options.model);
const modelRelative = relative(root, model).replaceAll('\\', '/');
if (modelRelative.startsWith('../')) throw new Error('El modelo debe estar dentro del proyecto.');
const parity = JSON.parse(await readFile(`${model}.parity.json`, 'utf8'));
const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
if (!executablePath) throw new Error('Configura PLAYWRIGHT_BROWSER_PATH con Chrome o Edge.');

const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 4180, strictPort: true, hmr: false, ws: false },
  plugins: [
    {
      name: 'ai-browser-harness',
      configureServer(vite) {
        vite.middlewares.use('/__ai_test__', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><title>Verificación neuronal</title>');
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  const runs = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto('http://127.0.0.1:4180/__ai_test__');
    const result = await page.evaluate(
      async ({ modelUrl, vectors }) => {
        const { createSparseNeuralEvaluator, createNeuralEvaluator, parseNeuralModel } =
          await import('/src/ai-neural.ts');
        const { createGameState, getAllLegalActions } = await import('/src/engine.ts');
        const response = await fetch(modelUrl);
        if (!response.ok) throw new Error('No se pudo cargar el modelo en el navegador.');
        const bytes = await response.arrayBuffer();
        const evaluate = createSparseNeuralEvaluator(bytes);
        let maximumError = 0;
        for (const vector of vectors) {
          maximumError = Math.max(
            maximumError,
            Math.abs(evaluate(vector.features) - vector.expectedScore),
          );
        }
        if (maximumError > 0.00001) throw new Error(`Error de paridad: ${maximumError}`);
        const iterations = 2_000;
        const startedAt = performance.now();
        for (let index = 0; index < iterations; index += 1) {
          evaluate(vectors[index % vectors.length].features);
        }
        const inferenceMs = performance.now() - startedAt;
        const state = createGameState([
          { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
          { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
          { id: 's0', type: 'soldier', owner: 0, position: { q: 0, r: -2 }, facing: 3 },
          { id: 's1', type: 'soldier', owner: 1, position: { q: 0, r: 2 }, facing: 0 },
        ]);
        const metadata = parseNeuralModel(bytes).metadata;
        const value = createNeuralEvaluator(bytes);
        const zeroSumError = Math.abs(value(state, 0) + value(state, 1));
        if (metadata.residualSymmetry === 'antisymmetric' && zeroSumError > 0.000001)
          throw new Error(`La evaluación no conserva suma cero: ${zeroSumError}`);
        const worker = new Worker(new URL('/src/ai-worker.ts', location.href), {
          type: 'module',
        });
        const search = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('La búsqueda neuronal no respondió.'));
          }, 15_000);
          worker.onerror = (event) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(event.message));
          };
          worker.onmessage = ({ data }) => {
            if (data.type !== 'result') return;
            clearTimeout(timer);
            worker.terminate();
            resolve(data);
          };
          worker.postMessage({
            id: 1,
            state,
            depth: 2,
            budgetMs: 500,
            difficulty: 'expert',
            personality: 'balanced',
            resolutionRules: { repetition: 3, noProgressPlyLimit: 120 },
            modelBytes: bytes,
          });
        });
        if (
          !getAllLegalActions(state).some(
            (action) => JSON.stringify(action) === JSON.stringify(search.action),
          ) ||
          search.metadata.completedDepth < 1
        ) {
          throw new Error('La búsqueda neuronal no completó una decisión legal.');
        }
        const { WorkerAiStrategy } = await import('/src/ai-strategy.ts');
        const { createClassicConfig } = await import('/src/game-config.ts');
        const strategy = new WorkerAiStrategy();
        const neuralState = createGameState(state.pieces, 1);
        const neuralConfig = createClassicConfig({ mode: 'machine', difficulty: 'neural' });
        let strategySearch = null;
        let fallback = null;
        try {
          const action = await strategy.chooseAction(neuralState, neuralConfig, {
            maxMs: 500,
            onProgress: (metadata) => {
              strategySearch = metadata;
            },
            onFallback: (message) => {
              fallback = message;
            },
          });
          if (
            fallback ||
            !getAllLegalActions(neuralState).some(
              (legal) => JSON.stringify(legal) === JSON.stringify(action),
            ) ||
            !strategySearch?.completedDepth
          ) {
            throw new Error(
              `El nivel Neuronal no usó el modelo incluido: ${fallback ?? 'acción inválida'}`,
            );
          }
        } finally {
          strategy.dispose();
        }
        return {
          maximumParityError: maximumError,
          residualSymmetry: metadata.residualSymmetry ?? null,
          zeroSumError,
          vectors: vectors.length,
          iterations,
          inferenceMs,
          averageInferenceMs: inferenceMs / iterations,
          modelBytes: bytes.byteLength,
          workerSearch: search.metadata,
          bundledNeuralLevelSearch: strategySearch,
          userAgent: navigator.userAgent,
        };
      },
      { modelUrl: `/${modelRelative}`, vectors: parity.vectors },
    );
    runs.push({ viewport, ...result });
    await page.close();
  }
  await writeJsonCheckpoint(options.output, {
    format: 'hex-neural-browser-v1',
    createdAt: new Date().toISOString(),
    note: 'Ambos tamaños usan el mismo ordenador; no representan rendimiento de un móvil físico.',
    runs,
  });
  console.log(JSON.stringify(runs, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
