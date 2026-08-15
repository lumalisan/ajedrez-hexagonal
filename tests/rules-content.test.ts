import { describe, expect, it } from 'vitest';

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

  it('incluye literalmente las revisiones de desarrollo y casillas compartidas', () => {
    const development = RULE_SECTIONS.find(({ id }) => id === 'desarrollo');
    const shared = RULE_SECTIONS.find(({ id }) => id === 'casillas-compartidas');
    const developmentText = development?.paragraphs.map(paragraphText).join('\n') ?? '';
    const sharedText = shared?.paragraphs.map(paragraphText).join('\n') ?? '';

    expect(developmentText).toContain(
      'La disposición inicial de los ejércitos sobre el tablero es la que aparece en la imagen de la derecha.',
    );
    expect(sharedText).toContain(
      'Hay que tener en cuenta que, si la unidad terrestre situada debajo del dron es un soldado o un embestidor, estos podrán atacarlo.',
    );
    expect(sharedText).toContain(
      'tanto el tanque como el lanzamisiles pueden ser abandonados para convertirse en soldados, lo que les permite igualmente atacar al dron en ese mismo turno.',
    );
    expect(sharedText).not.toContain('El vehículo puede abandonarse');
  });

  it('sustituye las secuencias de imágenes por demostraciones reales salvo la disposición inicial', () => {
    const animated = RULE_SECTIONS.filter(({ demo }) => demo);
    const staticMedia = RULE_SECTIONS.filter(({ media }) => media?.length);

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
    expect(staticMedia.map(({ id }) => id)).toEqual(['desarrollo']);
  });
});
