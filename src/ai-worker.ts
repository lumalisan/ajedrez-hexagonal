/// <reference lib="webworker" />

import { searchMachineActionWithMetadata } from './ai';
import type { AiDifficulty, AiPersonality, GameState } from './types';

interface SearchRequest {
  id: number;
  state: GameState;
  depth: number;
  budgetMs: number;
  difficulty: AiDifficulty;
  personality: AiPersonality;
  seed?: number;
}

self.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const result = searchMachineActionWithMetadata(request.state, {
    depth: request.depth,
    budgetMs: request.budgetMs,
    difficulty: request.difficulty,
    personality: request.personality,
    seed: request.seed,
    onProgress: (metadata) => {
      self.postMessage({ id: request.id, type: 'progress', metadata });
    },
  });
  self.postMessage({ id: request.id, type: 'result', ...result });
});
