/// <reference lib="webworker" />

import { searchMachineAction } from './ai';
import type { GameState } from './types';

interface SearchRequest {
  id: number;
  state: GameState;
  depth: 1 | 2 | 3;
  budgetMs: number;
}

self.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  const action = searchMachineAction(request.state, {
    depth: request.depth,
    budgetMs: request.budgetMs,
  });
  self.postMessage({ id: request.id, action });
});
