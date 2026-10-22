import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STORY_CHAPTERS } from '../../story-content';
import { useGame } from '../game-context';
import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const STORY_ILLUSTRATIONS = [
  'Una estación orbital crece hasta convertirse en un territorio artificial sobre la Tierra.',
  'Una red de plataformas se expande entre las estrellas mediante construcción automatizada.',
  'Investigadores humanos desarrollan una inteligencia artificial capaz de coordinar sistemas complejos.',
  'El núcleo de Hexfortia coordina la construcción de nuevas plataformas.',
  'La IA compara los asentamientos humanos con las instalaciones completamente automatizadas.',
  'Una ciudad industrial diseñada exclusivamente para máquinas.',
  'Los expansionistas preparan la recuperación de las plataformas desde su centro de mando.',
  'Los conservacionistas contemplan con preocupación la expansión de la red de plataformas.',
  'Tres facciones convergen sobre una plataforma con sus ejércitos de máquinas.',
  'Dos ejércitos de máquinas cian y ámbar despliegan sus fortalezas en el año 2488.',
];

const HORIZONTAL_CHAPTERS = '(max-width: 760px) and (orientation: portrait)';

export function StoryDialog() {
  const { commands } = useGame();
  const [selectedId, setSelectedId] = useState(STORY_CHAPTERS[0].id);
  const [horizontal, setHorizontal] = useState(
    () => window.matchMedia(HORIZONTAL_CHAPTERS).matches,
  );
  const articleRef = useRef<HTMLDivElement>(null);
  const focusArticle = useRef(false);
  const index = STORY_CHAPTERS.findIndex((chapter) => chapter.id === selectedId);

  useEffect(() => {
    const media = window.matchMedia(HORIZONTAL_CHAPTERS);
    const update = () => setHorizontal(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (articleRef.current) articleRef.current.scrollTop = 0;
    if (focusArticle.current) articleRef.current?.querySelector('h3')?.focus();
    focusArticle.current = false;
  }, [selectedId]);

  function activate(id: string, moveFocus = true) {
    focusArticle.current = moveFocus;
    setSelectedId(id);
    if (id === selectedId && moveFocus) {
      articleRef.current?.querySelector('h3')?.focus();
      focusArticle.current = false;
    }
  }

  return (
    <Tabs
      className="rules-shell story-shell"
      value={selectedId}
      onValueChange={(id) => activate(id, false)}
      orientation={horizontal ? 'horizontal' : 'vertical'}
    >
      <DialogClose label="Cerrar historia" className="dialog-corner-close rules-close" />
      <aside className="rules-sidebar">
        <div className="rules-heading story-heading">
          <div>
            <h2>El origen de Hexfortia</h2>
          </div>
        </div>
        <p>Selecciona un capítulo para descubrir la historia del juego.</p>
        <TabsList className="rules-navigation" aria-label="Capítulos de El origen de Hexfortia">
          {STORY_CHAPTERS.map((chapter) => (
            <TabsTrigger
              key={chapter.id}
              value={chapter.id}
              data-story-chapter={chapter.id}
              aria-controls={`story-${chapter.id}`}
              className={chapter.id === selectedId ? 'active' : undefined}
              onClick={() => activate(chapter.id)}
            >
              {chapter.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </aside>
      {STORY_CHAPTERS.map((chapter) => {
        const active = chapter.id === selectedId;
        return (
          <TabsContent
            key={chapter.id}
            value={chapter.id}
            id={`story-${chapter.id}`}
            hidden={!active}
            forceMount
            asChild
          >
            <div ref={active ? articleRef : undefined} className="rules-article story-article">
              {active && (
                <article className="rules-copy">
                  <span className="rules-kicker">
                    Capítulo {index + 1} de {STORY_CHAPTERS.length}
                  </span>
                  <img
                    className="story-illustration"
                    src={`${import.meta.env.BASE_URL}story/${chapter.id}.webp`}
                    alt={STORY_ILLUSTRATIONS[index]}
                    width="1536"
                    height="1024"
                    decoding="async"
                  />
                  <h3 tabIndex={-1}>{chapter.title}</h3>
                  {chapter.paragraphs.map((runs, paragraphIndex) => (
                    <p key={paragraphIndex}>
                      {runs.map((run, runIndex) => {
                        const text = run.italic ? <em>{run.text}</em> : run.text;
                        return run.bold ? (
                          <strong key={runIndex}>{text}</strong>
                        ) : (
                          <span key={runIndex}>{text}</span>
                        );
                      })}
                    </p>
                  ))}
                  <nav className="story-pagination" aria-label="Lectura de la historia">
                    {index > 0 && (
                      <Button onClick={() => activate(STORY_CHAPTERS[index - 1].id)}>
                        ← Capítulo anterior
                      </Button>
                    )}
                    <Button
                      variant={index === STORY_CHAPTERS.length - 1 ? 'primary' : 'secondary'}
                      onClick={() => {
                        commands.markStoryChapterRead(chapter.id);
                        if (index < STORY_CHAPTERS.length - 1)
                          activate(STORY_CHAPTERS[index + 1].id);
                        else commands.closeDialog();
                      }}
                    >
                      {index < STORY_CHAPTERS.length - 1
                        ? 'Capítulo siguiente →'
                        : 'Volver al menú'}
                    </Button>
                  </nav>
                </article>
              )}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
