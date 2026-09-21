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

  it('incluye literalmente las revisiones de desarrollo y casillas compartidas', () => {
    const development = RULE_SECTIONS.find(({ id }) => id === 'desarrollo');
    const shared = RULE_SECTIONS.find(({ id }) => id === 'casillas-compartidas');
    const developmentText = development?.paragraphs.map(paragraphText).join('\n') ?? '';
    const sharedText = shared?.paragraphs.map(paragraphText).join('\n') ?? '';

    expect(developmentText).toContain(
      'Explora la disposición inicial en el tablero y utiliza el selector para comparar las cinco formaciones.',
    );
    expect(sharedText).toContain(
      'Hay que tener en cuenta que, si la unidad terrestre situada debajo del dron es un soldado o un embestidor, estos podrán atacarlo.',
    );
    expect(sharedText).toContain(
      'tanto el tanque como el lanzamisiles pueden ser abandonados para convertirse en soldados, lo que les permite igualmente atacar al dron en ese mismo turno.',
    );
    expect(sharedText).not.toContain('El vehículo puede abandonarse');
  });

  it('explica sin divergencias el daño y los sacrificios contra la Fortaleza', () => {
    const fortress = RULE_SECTIONS.find(({ id }) => id === 'fortaleza');
    const text = fortress?.paragraphs.map(paragraphText).join('\n') ?? '';

    expect(FORTRESS_DAMAGE_PER_HIT).toBe(1);
    expect(FORTRESS_SACRIFICE_ATTACKERS).toEqual(['soldier', 'capturer', 'fast']);
    expect(text).toContain(`Cada impacto causa exactamente ${FORTRESS_DAMAGE_PER_HIT} punto`);
    expect(text).toContain('Soldado, Capturador y Embestidor se sacrifican');
    expect(text).toContain('1, 2 o 3 puntos de vida');
  });

  it('documenta todos los finales de classic-v2 y su persistencia', () => {
    const development = RULE_SECTIONS.find(({ id }) => id === 'desarrollo');
    const text = development?.paragraphs.map(paragraphText).join('\n') ?? '';

    expect(CLASSIC_REPETITION_LIMIT).toBe(3);
    expect(CLASSIC_NO_PROGRESS_LIMIT).toBe(120);
    expect(text).toContain('tercera aparición');
    expect(text).toContain(`${CLASSIC_NO_PROGRESS_LIMIT} medias jugadas (plies)`);
    expect(text).toContain('tablas por bloqueo');
    expect(text).toContain('acordar ese desenlace');
    expect(text).toContain('tiempo agotado');
    expect(text).toContain('rendición');
    expect(text).toContain('se conservan al continuar, exportar, importar o reproducir');
  });

  it('distingue las capas y describe la transformación como una sola orden', () => {
    const shared = RULE_SECTIONS.find(({ id }) => id === 'casillas-compartidas');
    const text = shared?.paragraphs.map(paragraphText).join('\n') ?? '';

    expect(text).toContain('dos capas: suelo y aire');
    expect(text).toContain('máximo una unidad terrestre y una unidad aérea');
    expect(text).toContain('Tanque, Lanzamisiles y Embestidor pueden ser abandonados');
    expect(text).toContain('no concede un segundo turno independiente');
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
