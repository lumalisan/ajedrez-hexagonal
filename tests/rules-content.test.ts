import { describe, expect, it } from 'vitest';

import {
  CLASSIC_NO_PROGRESS_LIMIT,
  CLASSIC_REPETITION_LIMIT,
  FORTRESS_DAMAGE_PER_HIT,
  FORTRESS_SACRIFICE_ATTACKERS,
} from '../src/classic-rules';
import { RULE_SECTIONS, type RuleParagraph } from '../src/rules-content';

const paragraphText = (paragraph: string | RuleParagraph): string =>
  typeof paragraph === 'string' ? paragraph : paragraph.text;

describe('contenido del reglamento', () => {
  it('mantiene cada énfasis dentro de su párrafo y en el orden declarado', () => {
    for (const section of RULE_SECTIONS) {
      for (const paragraph of section.paragraphs) {
        if (typeof paragraph === 'string' || !paragraph.strong) continue;
        let cursor = 0;
        for (const phrase of paragraph.strong) {
          const index = paragraph.text.indexOf(phrase, cursor);
          expect(index, `${section.id}: no se encontró «${phrase}»`).toBeGreaterThanOrEqual(cursor);
          cursor = index + phrase.length;
        }
      }
    }
  });

  it('presenta Fortaleza y Escudo antiaéreo como títulos del mismo nivel de contenido', () => {
    const section = RULE_SECTIONS.find(({ id }) => id === 'fortaleza');
    const shieldHeading = section?.paragraphs.find(
      (paragraph) => typeof paragraph !== 'string' && paragraph.kind === 'heading',
    );

    expect(section?.title).toBe('Fortaleza');
    expect(shieldHeading).toMatchObject({ text: 'Escudo antiaéreo', kind: 'heading' });
  });

  it('incorpora el texto revisado de desarrollo y casillas compartidas', () => {
    const text = (id: string) =>
      RULE_SECTIONS.find((section) => section.id === id)
        ?.paragraphs.map(paragraphText)
        .join('\n') ?? '';
    expect(text('desarrollo')).toContain('el número de asaltadores aumenta a 11');
    expect(text('desarrollo')).toContain('durante 5 turnos consecutivos');
    expect(text('desarrollo')).toContain('agota el tiempo disponible en 3 ocasiones');
    expect(text('casillas-compartidas')).toContain('nunca dos unidades en una misma capa');
    expect(text('casillas-compartidas')).toContain(
      'solo puede atacar a una de ellas en cada acción',
    );
    expect(text('casillas-compartidas')).toContain(
      'Si la unidad terrestre situada debajo del dron es un asaltador o un embestidor, podrá atacarlo.',
    );
    expect(FORTRESS_DAMAGE_PER_HIT).toBe(1);
    expect(FORTRESS_SACRIFICE_ATTACKERS).toEqual(['soldier', 'capturer', 'fast']);
    expect(text('fortaleza')).toContain('fortaleza le resta un punto de vida');
    expect(text('fortaleza')).toContain('se sacrifican después de impactar');
    expect(CLASSIC_REPETITION_LIMIT).toBe(3);
    expect(CLASSIC_NO_PROGRESS_LIMIT).toBe(120);
  });

  it('incluye experiencia, clasificación y la tabla accesible de XP', () => {
    const experience = RULE_SECTIONS.find(({ id }) => id === 'experiencia');
    expect(
      experience?.paragraphs.find((p) => typeof p !== 'string' && p.kind === 'table'),
    ).toMatchObject({
      columns: ['Nivel', 'Derrota o tablas', 'Victoria'],
      rows: [
        ['Fácil', '15 XP', '25 XP'],
        ['Medio', '25 XP', '50 XP'],
        ['Difícil', '35 XP', '75 XP'],
        ['Experto', '50 XP', '100 XP'],
      ],
    });
    const ranking = RULE_SECTIONS.find(({ id }) => id === 'clasificacion');
    expect(ranking?.paragraphs.map(paragraphText).join(' ')).toContain(
      '1000 puntos de clasificación',
    );
  });

  it('presenta demostraciones reales y un tablero de disposiciones sin imágenes estáticas', () => {
    const animated = RULE_SECTIONS.filter(({ demo }) => demo);
    const deployments = RULE_SECTIONS.filter(({ layoutPreview }) => layoutPreview);

    expect(animated.map(({ id }) => id)).toEqual([
      'fortaleza',
      'soldado',
      'capturador',
      'tanque',
      'lanzamisiles',
      'embestidor',
      'dron',
      'avion',
      'casillas-compartidas',
    ]);
    expect(deployments.map(({ id }) => id)).toEqual(['desarrollo']);
    expect(JSON.stringify(RULE_SECTIONS)).not.toContain('/rules/');
  });
});
