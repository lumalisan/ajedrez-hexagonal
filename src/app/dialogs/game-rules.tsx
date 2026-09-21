import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { RULE_SECTIONS, type RuleParagraph, type RuleSection } from '../../rules-content';
import { mountRuleDemo, type RuleDemoController, type RuleDemoId } from '../../rules-demo';
import { useGame } from '../game-context';
import { RendererStatus } from '../components/renderer-status';

const HORIZONTAL_RULE_TABS = '(max-width: 760px) and (orientation: portrait)';

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
  const navigationRef = useRef<HTMLDivElement>(null);
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

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const index = visibleSections.findIndex((candidate) => candidate.id === id);
    if (index < 0 || !visibleSections.length) return;
    const next =
      event.key === 'Home'
        ? visibleSections[0]
        : event.key === 'End'
          ? visibleSections.at(-1)!
          : visibleSections[
              (index +
                (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) +
                visibleSections.length) %
                visibleSections.length
            ];
    navigationRef.current
      ?.querySelector<HTMLButtonElement>(`[data-rule-section="${next.id}"]`)
      ?.focus();
    activate(next.id, false);
  }

  return (
    <div className="rules-shell">
      <aside className="rules-sidebar">
        <div className="rules-heading">
          <div>
            <span className="rules-kicker">MANUAL DE CAMPO</span>
            <h2>Reglas</h2>
          </div>
          <button
            type="button"
            className="rules-close"
            data-dialog-close
            aria-label="Cerrar reglas"
            onClick={commands.closeDialog}
          >
            ×
          </button>
        </div>
        <p>Selecciona una sección para consultar las reglas de Protocolo Hexagonal.</p>
        <label className="rules-search">
          <span className="sr-only">Buscar en las reglas</span>
          <input
            type="search"
            data-rule-search
            placeholder="Buscar..."
            autoComplete="off"
            value={query}
            onChange={(event) => changeQuery(event.currentTarget.value)}
          />
        </label>
        <div
          ref={navigationRef}
          className="rules-navigation"
          role="tablist"
          aria-label="Secciones del reglamento"
          aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        >
          {RULE_SECTIONS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              data-rule-section={candidate.id}
              aria-selected={candidate.id === selectedId}
              aria-controls="rules-article"
              className={candidate.id === selectedId ? 'active' : ''}
              tabIndex={candidate.id === selectedId ? 0 : -1}
              hidden={!sectionMatches(candidate, normalizedQuery)}
              onClick={() => activate(candidate.id)}
              onKeyDown={(event) => navigateTabs(event, candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </aside>
      <article ref={articleRef} id="rules-article" className="rules-article" role="tabpanel">
        {section ? (
          <RuleArticle key={section.id} section={section} />
        ) : (
          <div className="rules-empty" role="status">
            <strong>Sin coincidencias</strong>
            <p>Prueba con el nombre de una unidad, acción o condición de victoria.</p>
          </div>
        )}
      </article>
    </div>
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
  return (
    <>
      <div className="rules-copy">
        <span className="rules-kicker">PROTOCOLO HEXAGONAL</span>
        <h3 tabIndex={-1}>{section.title}</h3>
        {section.paragraphs.map((paragraph, index) =>
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
        )}
      </div>
      {section.demo ? (
        <RuleDemo demoId={section.demo} title={section.title} />
      ) : section.media?.length ? (
        <figure className="rule-media" aria-label={`Ilustración de ${section.title}`}>
          <div className="rule-media-stage">
            <div className="rule-media-track">
              {section.media.map((item) => (
                <img key={item.src} src={item.src} alt={item.alt} loading="lazy" />
              ))}
            </div>
          </div>
        </figure>
      ) : null}
    </>
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
