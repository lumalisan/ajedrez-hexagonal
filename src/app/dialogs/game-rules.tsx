import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RULE_SECTIONS, type RuleParagraph, type RuleSection } from '../../rules-content';
import { mountRuleDemo, type RuleDemoController, type RuleDemoId } from '../../rules-demo';
import { PIECE_NAMES } from '../../engine';
import { mountLayoutPreview, type LayoutPreview } from '../../layout-preview';
import { INITIAL_LAYOUTS, createInitialPieces, type InitialLayout } from '../../setup';
import { useGame } from '../game-context';
import { GameSelect } from '../components/game-select';
import { RendererStatus } from '../components/renderer-status';
import { IconButton } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const HORIZONTAL_RULE_TABS = '(max-width: 760px) and (orientation: portrait)';
const LAYOUT_OPTIONS = INITIAL_LAYOUTS.map(({ id, name }) => ({ value: id, label: name }));

export function RulesDialog({ sectionId }: { sectionId?: string }) {
  const { commands } = useGame();
  const [selectedId, setSelectedId] = useState(
    () => RULE_SECTIONS.find((section) => section.id === sectionId)?.id ?? RULE_SECTIONS[0].id,
  );
  const [query, setQuery] = useState('');
  const [horizontal, setHorizontal] = useState(
    () => window.matchMedia(HORIZONTAL_RULE_TABS).matches,
  );
  const articleRef = useRef<HTMLElement>(null);
  const focusArticleRef = useRef(false);
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const visibleSections = RULE_SECTIONS.filter((section) =>
    sectionMatches(section, normalizedQuery),
  );
  const section = visibleSections.find((candidate) => candidate.id === selectedId);

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

  function changeQuery(value: string) {
    setQuery(value);
    const normalized = value.trim().toLocaleLowerCase('es');
    const matches = RULE_SECTIONS.filter((candidate) => sectionMatches(candidate, normalized));
    if (matches.length && !matches.some((candidate) => candidate.id === selectedId)) {
      activate(matches[0].id, false);
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
      <aside className="rules-sidebar">
        <div className="rules-heading">
          <div>
            <span className="rules-kicker">MANUAL DE CAMPO</span>
            <h2>Reglas</h2>
          </div>
          <IconButton
            className="rules-close"
            data-dialog-close
            label="Cerrar reglas"
            onClick={commands.closeDialog}
          >
            ×
          </IconButton>
        </div>
        <p>Selecciona una sección para consultar las reglas de Protocolo Hexagonal.</p>
        <label className="rules-search">
          <span className="sr-only">Buscar en las reglas</span>
          <Input
            type="search"
            data-rule-search
            placeholder="Buscar..."
            autoComplete="off"
            value={query}
            onChange={(event) => changeQuery(event.currentTarget.value)}
          />
        </label>
        <TabsList className="rules-navigation" aria-label="Secciones del reglamento">
          {RULE_SECTIONS.map((candidate) => {
            const filteredOut = !sectionMatches(candidate, normalizedQuery);
            return (
              <TabsTrigger
                key={candidate.id}
                value={candidate.id}
                data-rule-section={candidate.id}
                aria-controls={panelId(candidate.id)}
                className={candidate.id === selectedId ? 'active' : undefined}
                hidden={filteredOut}
                disabled={filteredOut}
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
            <article ref={active ? articleRef : undefined} className="rules-article">
              {active && <RuleArticle section={candidate} />}
            </article>
          </TabsContent>
        );
      })}
      {!section && (
        <article ref={articleRef} id="rules-article" className="rules-article">
          <div className="rules-empty" role="status">
            <strong>Sin coincidencias</strong>
            <p>Prueba con el nombre de una unidad, acción o condición de victoria.</p>
          </div>
        </article>
      )}
    </Tabs>
  );
}

function sectionMatches(section: RuleSection, query: string): boolean {
  return (
    !query ||
    `${section.label} ${section.title} ${section.paragraphs.map(paragraphText).join(' ')}`
      .toLocaleLowerCase('es')
      .includes(query)
  );
}

function paragraphText(paragraph: string | RuleParagraph): string {
  return typeof paragraph === 'string' ? paragraph : paragraph.text;
}

function RuleArticle({ section }: { section: RuleSection }) {
  const introductoryParagraphs = section.layoutPreview
    ? section.paragraphs.slice(0, 2)
    : section.paragraphs;
  return (
    <>
      <div className="rules-copy">
        <span className="rules-kicker">PROTOCOLO HEXAGONAL</span>
        <h3 tabIndex={-1}>{section.title}</h3>
        <RuleParagraphs paragraphs={introductoryParagraphs} />
      </div>
      {section.demo ? (
        <RuleDemo demoId={section.demo} title={section.title} />
      ) : section.layoutPreview ? (
        <>
          <RuleLayoutPreview />
          <div className="rules-copy rules-deployment-rest">
            <RuleParagraphs paragraphs={section.paragraphs.slice(2)} />
          </div>
        </>
      ) : null}
    </>
  );
}

function RuleParagraphs({ paragraphs }: { paragraphs: RuleSection['paragraphs'] }) {
  return paragraphs.map((paragraph, index) =>
    typeof paragraph !== 'string' && paragraph.kind === 'heading' ? (
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
  const [initialLayout, setInitialLayout] = useState<InitialLayout>(1);
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
      <figcaption id="rules-layout-caption">
        Cian abajo · Ámbar arriba · {army.length} piezas por bando
      </figcaption>
      <p
        id="rules-layout-description"
        className="mb-0 mt-3 text-sm leading-relaxed text-muted"
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
  const controllerRef = useRef<RuleDemoController | null>(null);
  const [caption, setCaption] = useState('Preparando la demostración…');
  const [playback, setPlayback] = useState({ paused: reducedMotion, reducedMotion });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = mountRuleDemo(canvas, demoId, {
      reducedMotion,
      highContrast,
      onSceneChange: (label, index, total) => setCaption(`${index + 1}/${total} · ${label}`),
      onPlaybackChange: (paused, reduceMotion) =>
        setPlayback({ paused, reducedMotion: reduceMotion }),
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.destroy();
    };
  }, [demoId, reducedMotion, highContrast]);

  return (
    <figure className="rule-media rule-demo" aria-label={`Demostración de ${title}`}>
      <div className="rule-media-stage">
        <canvas ref={canvasRef} className="rule-demo-canvas" />
        <RendererStatus canvasRef={canvasRef} overlay />
        <span className="rule-demo-badge" aria-hidden="true">
          <i /> Demostración real
        </span>
      </div>
      <figcaption data-rule-demo-caption>{caption}</figcaption>
      <div className="rule-demo-controls" aria-label="Controles de la demostración">
        <button
          type="button"
          data-demo-toggle
          disabled={playback.reducedMotion}
          onClick={() => controllerRef.current?.togglePlayback()}
        >
          {playback.reducedMotion
            ? 'Movimiento reducido'
            : playback.paused
              ? 'Reproducir'
              : 'Pausar'}
        </button>
        <button type="button" data-demo-step onClick={() => controllerRef.current?.advanceStep()}>
          Paso a paso
        </button>
        <button type="button" data-demo-restart onClick={() => controllerRef.current?.restart()}>
          Reiniciar
        </button>
      </div>
    </figure>
  );
}
