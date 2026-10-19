/// <reference lib="webworker" />

import { searchMachineActionWithMetadata } from './ai';
import { createNeuralEvaluator } from './ai-neural';
import type { ActionResolutionRules } from './engine';
import type { AiDifficulty, AiPersonality, GameState } from './types';

interface SearchRequest {
  id: number;
  state: GameState;
  depth: number;
  budgetMs: number;
  difficulty: AiDifficulty;
  personality: AiPersonality;
  resolutionRules: Readonly<ActionResolutionRules>;
  seed?: number;
  modelBytes?: ArrayBuffer;
}

self.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const result = searchMachineActionWithMetadata(request.state, {
    depth: request.depth,
    budgetMs: request.budgetMs,
    difficulty: request.difficulty,
    personality: request.personality,
    seed: request.seed,
    resolutionRules: request.resolutionRules,
    ...(request.modelBytes ? { evaluate: createNeuralEvaluator(request.modelBytes) } : {}),
    onProgress: (metadata) => {
      self.postMessage({ id: request.id, type: 'progress', metadata });
    },
  });
  self.postMessage({ id: request.id, type: 'result', ...result });
});
