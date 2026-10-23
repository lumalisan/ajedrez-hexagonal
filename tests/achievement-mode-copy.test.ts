import { describe, expect, it } from 'vitest';
import { achievementModeDescription } from '../src/achievement-mode-copy';

describe('explicación conjunta de las modalidades de un logro', () => {
  it.each([
    [0, 'Solo partidas contra Hexfortia.'],
    [1, 'Solo partidas contra Hexfortia en nivel medio o superior.'],
    [2, 'Solo partidas contra Hexfortia en nivel difícil o experto.'],
    [3, 'Solo partidas contra Hexfortia en nivel experto.'],
  ])('explica Hexfortia con dificultad mínima %i', (difficulty, expected) => {
    expect(achievementModeDescription(['machine'], difficulty)).toBe(expected);
  });

  it.each([
    [0, 'Solo en partidas contra Hexfortia o en línea.'],
    [1, 'Solo en partidas contra Hexfortia (nivel medio o superior) o en línea.'],
    [2, 'Solo en partidas contra Hexfortia (nivel difícil o experto) o en línea.'],
    [3, 'Solo en partidas contra Hexfortia (nivel experto) o en línea.'],
  ])('combina Hexfortia y partidas en línea con dificultad mínima %i', (difficulty, expected) => {
    expect(achievementModeDescription(['machine', 'online'], difficulty)).toBe(expected);
  });

  it.each([
    [
      0,
      'Cualquier modo de juego es válido. En las partidas locales, solo cuentan las acciones del jugador local.',
    ],
    [
      1,
      'En partidas contra Hexfortia (nivel medio o superior), en línea o locales. En las partidas locales, solo cuentan las acciones del jugador local.',
    ],
    [
      2,
      'En partidas contra Hexfortia (nivel difícil o experto), en línea o locales. En las partidas locales, solo cuentan las acciones del jugador local.',
    ],
    [
      3,
      'En partidas contra Hexfortia (nivel experto), en línea o locales. En las partidas locales, solo cuentan las acciones del jugador local.',
    ],
  ])('combina las tres modalidades con dificultad mínima %i', (difficulty, expected) => {
    expect(achievementModeDescription(['machine', 'online', 'local'], difficulty)).toBe(expected);
  });

  it('explica las restricciones de las partidas en línea y locales', () => {
    expect(achievementModeDescription(['online'], 0)).toBe('Solo en partidas en línea.');
    expect(achievementModeDescription(['local'], 0)).toBe('Solo en partidas locales.');
  });

  it('mantiene el orden de lectura aunque cambie el orden de los modos', () => {
    expect(achievementModeDescription(['local', 'online', 'machine'], 0)).toBe(
      'Cualquier modo de juego es válido. En las partidas locales, solo cuentan las acciones del jugador local.',
    );
  });

  it('omite la explicación para logros sin restricción de modalidad', () => {
    expect(achievementModeDescription([], 0)).toBe('');
  });
});

it.each(['matches', 'year2488'])('omite la aclaración de acciones para %s', (metric) => {
  expect(achievementModeDescription(['machine', 'online', 'local'], 0, metric)).toBe(
    'Cualquier modo de juego es válido.',
  );
});
