import { createContext, useContext, useSyncExternalStore } from 'react';
import type { GameSession } from './contracts';

export const GameContext = createContext<GameSession | null>(null);

export function useGame() {
  const session = useContext(GameContext);
  if (!session) throw new Error('La interfaz necesita una sesión de partida.');
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { snapshot, commands: session.commands, session };
}
