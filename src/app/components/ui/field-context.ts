import { createContext } from 'react';

export interface FieldContextValue {
  controlId: string;
  disabled: boolean;
  invalid: boolean;
  required: boolean;
  descriptionIds: readonly string[];
  errorIds: readonly string[];
  registerDescription(id: string, error: boolean): () => void;
}

export const FieldContext = createContext<FieldContextValue | null>(null);
