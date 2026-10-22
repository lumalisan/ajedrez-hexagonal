import { DialogClose } from '../components/dialog-close';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RULE_SECTIONS, type RuleParagraph, type RuleSection } from '../../rules-content';
import { mountRuleDemo, type RuleDemoId } from '../../rules-demo';
import { PIECE_NAMES } from '../../engine';
import { mountLayoutPreview, type LayoutPreview } from '../../layout-preview';
import {
  INITIAL_LAYOUTS,
  MATCH_INITIAL_LAYOUTS,
  createInitialPieces,
  type InitialLayout,
} from '../../setup';
import { useGame } from '../game-context';
import { GameSelect } from '../components/game-select';
import { RendererStatus } from '../components/renderer-status';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { RULE_UNIT_APPEARANCES, UNIT_APPEARANCE } from '../../unit-appearance';

const HORIZONTAL_RULE_TABS = '(max-width: 760px) and (orientation: portrait)';
const LAYOUT_OPTIONS = MATCH_INITIAL_LAYOUTS.map(({ id, name }) => ({ value: id, label: name }));

export function RulesDialog({ sectionId }: { sectionId?: string }) {
  const [selectedId, setSelectedId] = useState(
    () => RULE_SECTIONS.find((section) => section.id === sectionId)?.id ?? RULE_SECTIONS[0].id,
  );
  const [horizontal, setHorizontal] = useState(
    () => window.matchMedia(HORIZONTAL_RULE_TABS).matches,
  );
  const articleRef = useRef<HTMLDivElement>(null);
  const focusArticleRef = useRef(false);
  const section = RULE_SECTIONS.find((candidate) => candidate.id === selectedId)!;

  useEffect(() => {
    const media = window.matchMedia(HORIZONTAL_RULE_TABS);
    const updateOrientation = () => setHorizontal(media.matches);
    media.addEventListener('change', updateOrientation);
    return () => media.removeEventListener('change', updateOrientation);
  }, []);

  useLayoutEffect(() => {
    if (articleRef.current) articleRef.current.scrollTop = 0;
    if (focusArticleRef.current) articleRef.current?.querySelector('h3')?.focus();
    focusArticleRef.current = false;
  }, [section?.id]);

  function activate(id: string, moveFocus = true) {
    focusArticleRef.current = moveFocus;
    setSelectedId(id);
    if (id === selectedId && moveFocus) {
      articleRef.current?.querySelector('h3')?.focus();
      focusArticleRef.current = false;
    }
  }

  function panelId(id: string) {
    // Preserve the active article's public hook while every tab keeps an ARIA target.
    return id === section?.id ? 'rules-article' : `rules-article-${id}`;
  }

  return (
    <Tabs
      className="rules-shell"
      value={selectedId}
      onValueChange={(id) => activate(id, false)}
      orientation={horizontal ? 'horizontal' : 'vertical'}
    >
      <DialogClose label="Cerrar reglas" className="dialog-corner-close rules-close" />
      <aside className="rules-sidebar">
        <div className="rules-heading">
          <div>
            <h2>Reglas</h2>
          </div>
        </div>
        <p>Selecciona una sección para consultar las reglas de Hexfortia.</p>
        <TabsList className="rules-navigation" aria-label="Secciones del reglamento">
          {RULE_SECTIONS.map((candidate) => {
            return (
              <TabsTrigger
                key={candidate.id}
                value={candidate.id}
                data-rule-section={candidate.id}
                aria-controls={panelId(candidate.id)}
                className={candidate.id === selectedId ? 'active' : undefined}
                onClick={() => activate(candidate.id)}
              >
                {candidate.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </aside>
      {RULE_SECTIONS.map((candidate) => {
        const active = candidate.id === section?.id;
        return (
          <TabsContent
            key={candidate.id}
            value={candidate.id}
            id={panelId(candidate.id)}
            hidden={!active}
            forceMount
            asChild
          >
            <div ref={active ? articleRef : undefined} className="rules-article">
              {active && <RuleArticle section={candidate} />}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function paragraphText(paragraph: string | RuleParagraph): string {
  return typeof paragraph === 'string' ? paragraph : paragraph.text;
}

function RuleArticle({ section }: { section: RuleSection }) {
  if (section.id === 'fortaleza') {
    const shieldIndex = section.paragraphs.findIndex(
      (p) => typeof p !== 'string' && p.kind === 'heading',
    );
    return (
      <div className="rules-section rules-fortress-section">
        <div className="rules-copy">
          <h3 tabIndex={-1}>{section.title}</h3>
          <RuleParagraphs paragraphs={section.paragraphs.slice(0, shieldIndex)} />
        </div>
        <UnitReference type="fortress" />
        <div className="rules-copy">
          <RuleParagraphs paragraphs={section.paragraphs.slice(shieldIndex)} />
        </div>
        <UnitReference type="antiAir" />
        <RuleDemo demoId="fortaleza" title="Fortaleza y escudo antiaéreo" />
      </div>
    );
  }
  const introductoryParagraphs = section.layoutPreview
    ? section.paragraphs.slice(0, 1)
    : section.paragraphs;
  return (
    <div
      className={`rules-section${RULE_UNIT_APPEARANCES[section.id] ? ' rules-section-with-reference' : ''}`}
    >
      <div className={`rules-copy${section.id === 'descripcion' ? ' rules-description' : ''}`}>
        {section.id === 'descripcion' && (
          <img
            className="story-illustration"
            src={`${import.meta.env.BASE_URL}story/chapter-10.webp`}
            alt="Dos ejércitos de máquinas cian y ámbar despliegan sus fortalezas en el año 2488."
            width="1536"
            height="1024"
            decoding="async"
          />
        )}
        <h3 tabIndex={-1}>{section.title}</h3>
        <RuleParagraphs paragraphs={introductoryParagraphs} />
      </div>
      {RULE_UNIT_APPEARANCES[section.id] && (
        <div className="rule-unit-references">
          {RULE_UNIT_APPEARANCES[section.id].map((type) => {
            const appearance = UNIT_APPEARANCE[type];
            return (
              <figure key={type} className="rule-unit-reference">
                <img
                  src={`${import.meta.env.BASE_URL}units/${type}.webp`}
                  alt={appearance.description}
                  width="768"
                  height="512"
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            );
          })}
        </div>
      )}
      {section.demo ? (
        <RuleDemo demoId={section.demo} title={section.title} />
      ) : section.layoutPreview ? (
        <>
          <RuleLayoutPreview />
          <div className="rules-copy rules-deployment-rest">
            <RuleParagraphs paragraphs={section.paragraphs.slice(1)} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function UnitReference({ type }: { type: 'fortress' | 'antiAir' }) {
  return (
    <figure className="rule-unit-reference">
      <img
        src={`${import.meta.env.BASE_URL}units/${type}.webp`}
        alt={UNIT_APPEARANCE[type].description}
        width="768"
        height="512"
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}

function RuleParagraphs({ paragraphs }: { paragraphs: RuleSection['paragraphs'] }) {
  return paragraphs.map((paragraph, index) =>
    typeof paragraph !== 'string' && paragraph.kind === 'table' ? (
      <div key={index} className="rules-table-wrap">
        <table className="rules-table">
          <caption className="sr-only">{paragraph.text}</caption>
          <thead>
            <tr>
              {paragraph.columns?.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paragraph.rows?.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : typeof paragraph !== 'string' && paragraph.kind === 'heading' ? (
      <h3 key={index} className="rules-peer-heading">
        {paragraph.text}
      </h3>
    ) : (
      <p key={index}>
        {emphasizedText(
          paragraphText(paragraph),
          typeof paragraph === 'string' ? [] : (paragraph.strong ?? []),
        )}
      </p>
    ),
  );
}

function RuleLayoutPreview() {
  const { snapshot } = useGame();
  const { highContrast } = snapshot.preferences;
  const [initialLayout, setInitialLayout] = useState<InitialLayout>(3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<LayoutPreview | null>(null);
  const layout = INITIAL_LAYOUTS.find(({ id }) => id === initialLayout)!;
  const pieces = createInitialPieces(2, initialLayout);
  const army = pieces.filter((piece) => piece.owner === 0);
  const roster = Object.entries(PIECE_NAMES)
    .map(([type, name]) => `${name}: ${army.filter((piece) => piece.type === type).length}`)
    .join('; ');

  useEffect(() => {
    if (!canvasRef.current) return;
    const options = { initialLayout, fortressHp: 2 as const, highContrast, fullBoard: true };
    if (previewRef.current) previewRef.current.update(options);
    else previewRef.current = mountLayoutPreview(canvasRef.current, options);
  }, [initialLayout, highContrast]);

  useEffect(
    () => () => {
      previewRef.current?.destroy();
      previewRef.current = null;
    },
    [],
  );

  return (
    <figure className="rule-media rule-layout-preview" aria-label="Disposiciones iniciales">
      <div className="mb-3 grid gap-2">
        <label htmlFor="rules-layout-setting" className="font-semibold text-ink">
          Disposición inicial
        </label>
        <GameSelect
          inputId="rules-layout-setting"
          options={LAYOUT_OPTIONS}
          value={initialLayout}
          onChange={setInitialLayout}
          describedBy="rules-layout-description"
        />
      </div>
      <div className="rule-media-stage">
        <canvas
          ref={canvasRef}
          className="rule-demo-canvas"
          data-rules-layout-preview
          data-layout={initialLayout}
          data-piece-count={pieces.length}
          role="img"
          aria-label={`Disposición ${layout.name}: tablero completo de 91 casillas`}
          aria-describedby="rules-layout-caption rules-layout-description rules-layout-roster"
        />
        <RendererStatus canvasRef={canvasRef} overlay />
      </div>
      <figcaption id="rules-layout-caption" className="sr-only">
        Cian abajo · Ámbar arriba · {army.length} piezas por bando
      </figcaption>
      <p
        id="rules-layout-description"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {layout.description}
      </p>
      <p id="rules-layout-roster" className="sr-only">
        Composición de cada bando: {roster}. Las fortalezas tienen dos puntos de vida.
      </p>
    </figure>
  );
}

function emphasizedText(text: string, phrases: string[]): ReactNode[] {
  let cursor = 0;
  const nodes: ReactNode[] = [];
  for (const phrase of phrases) {
    const index = text.indexOf(phrase, cursor);
    if (index < 0) continue;
    nodes.push(text.slice(cursor, index), <strong key={index}>{phrase}</strong>);
    cursor = index + phrase.length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

function RuleDemo({ demoId, title }: { demoId: RuleDemoId; title: string }) {
  const { snapshot } = useGame();
  const { reducedMotion, highContrast } = snapshot.preferences;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = mountRuleDemo(canvas, demoId, {
      reducedMotion,
      highContrast,
    });
    return () => {
      controller.destroy();
    };
  }, [demoId, reducedMotion, highContrast]);

  return (
    <figure className="rule-media rule-demo" aria-label={`Demostración de ${title}`}>
      <div className="rule-media-stage">
        <canvas ref={canvasRef} className="rule-demo-canvas" />
        <RendererStatus canvasRef={canvasRef} overlay />
      </div>
    </figure>
  );
}
