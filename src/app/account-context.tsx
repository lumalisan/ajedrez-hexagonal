import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AccountController } from '../account-controller';

export const AccountContext = createContext<AccountController | null>(null);
export function useAccount() {
  const controller = useContext(AccountContext);
  if (!controller) throw new Error('Falta el contexto de cuenta.');
  return {
    account: useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    controller,
  };
}
