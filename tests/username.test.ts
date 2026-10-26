import { describe, expect, it } from 'vitest';
import { validateUsername } from '../src/username';

describe('nombres de usuario', () => {
  it('normaliza variantes Unicode y elimina espacios exteriores', () => {
    expect(validateUsername('  Ｒｏｌｄ88　')).toBe('Rold88');
    expect(validateUsername('Cian Ámbar')).toBe('Cian Ámbar');
  });
  it.each(['', '   ', 'a'.repeat(25), 'Cian\nÁmbar', 'Cian\u200b'])('rechaza %j', (value) => {
    expect(() => validateUsername(value)).toThrow('entre 1 y 24');
  });
});
