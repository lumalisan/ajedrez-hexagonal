import { describe, expect, it } from 'vitest';

import { captureAboveCommandLabel } from '../src/ui-copy';

describe('textos de acciones sobre capas', () => {
  it('usa la etiqueta genérica aeronave tanto para Dron como para Avión', () => {
    expect(captureAboveCommandLabel('drone')).toBe('Capturar aeronave superior');
    expect(captureAboveCommandLabel('airplane')).toBe('Capturar aeronave superior');
  });

  it('rechaza tipos terrestres para evitar etiquetas engañosas', () => {
    expect(() => captureAboveCommandLabel('soldier')).toThrow(/solo admite unidades aéreas/u);
  });
});
