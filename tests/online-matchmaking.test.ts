import { describe, expect, it, vi } from 'vitest';
import {
  eloSearchRange,
  matchSearchTickets,
  validPrivateCode,
  type SearchTicket,
} from '../src/online-matchmaking';

const ticket = (playerId: string, elo = 1000, joinedAt = 0): SearchTicket => ({
  playerId,
  elo,
  joinedAt,
});

describe('partidas públicas estándar', () => {
  it.each([
    [0, ['expansionist', 'conservationist']],
    [0.499, ['expansionist', 'conservationist']],
    [0.5, ['conservationist', 'expansionist']],
    [0.999, ['conservationist', 'expansionist']],
  ])('sortea bandos opuestos con %s y mantiene las reglas públicas', (roll, factions) => {
    const random = vi.fn(() => roll as number);
    expect(matchSearchTickets(ticket('a'), ticket('b'), 0, random)).toEqual({
      factions,
      fortressHp: 1,
      turnSeconds: 30,
      totalSeconds: '',
      layout: 3,
    });
    expect(random).toHaveBeenCalledOnce();
  });

  it('respeta ambas ventanas de Elo, hasta un máximo de 400', () => {
    expect([0, 14999, 15000, 60000, 999999].map(eloSearchRange)).toEqual([200, 200, 250, 400, 400]);
    const a = ticket('a');
    expect(matchSearchTickets(a, ticket('b', 1200), 0, () => 0)).not.toBeNull();
    expect(matchSearchTickets(a, ticket('b', 1201), 0, () => 0)).toBeNull();
    expect(matchSearchTickets(a, ticket('b', 1400), 60000, () => 0)).not.toBeNull();
    expect(matchSearchTickets(a, ticket('b', 1401), 999999, () => 0)).toBeNull();
    expect(matchSearchTickets(a, ticket('b', 1400, 60000), 60000, () => 0)).toBeNull();
  });

  it('rechaza el mismo jugador y tickets inválidos sin consumir el sorteo', () => {
    const random = vi.fn(() => 0);
    const a = ticket('a');
    for (const other of [a, ticket(''), ticket('b', NaN), ticket('b', -1), ticket('b', 1000, 1)])
      expect(matchSearchTickets(a, other, 0, random)).toBeNull();
    expect(matchSearchTickets(a, ticket('b'), NaN, random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
    for (const value of [NaN, -0.1, 1])
      expect(() => matchSearchTickets(a, ticket('b'), 0, () => value)).toThrow('El sorteo');
  });

  it('solo admite códigos privados numéricos de seis cifras, incluidos ceros iniciales', () => {
    expect(validPrivateCode('012345')).toBe(true);
    for (const value of ['12345', '1234567', '123a56', ' 123456'])
      expect(validPrivateCode(value)).toBe(false);
  });
});
