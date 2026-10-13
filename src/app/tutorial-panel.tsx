import { useLayoutEffect, useRef } from 'react';
import { TUTORIAL_STEPS } from '../tutorial';
import { useGame } from './game-context';

/** The tutorial inherits the board's command-window styling and keeps its instructions beside play. */
export function TutorialPanel() {
  const { snapshot, commands } = useGame();
  const contentRef = useRef<HTMLDivElement>(null);
  const tutorial = snapshot.tutorial;
  const step = tutorial ? TUTORIAL_STEPS[tutorial.stepIndex] : undefined;
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [tutorial?.stepIndex, tutorial?.completed]);
  if (!tutorial || !step) return null;
  const completed = tutorial.completed;
  return (
    <aside
      id="tutorial-panel"
      className="tutorial-panel"
      aria-label="Instrucciones del tutorial"
      data-tutorial-step={step.id}
    >
      <div className="tutorial-titlebar">
        <span>Tutorial</span>
        <span className="tutorial-progress">
          {completed ? 'Completado' : step.section === 0 ? 'Inicio' : `${step.section} de 14`}
        </span>
      </div>
      <div className="tutorial-content" ref={contentRef} tabIndex={0}>
        <h1 id="tutorial-heading" aria-live="polite" aria-atomic="true">
          {completed ? '¡Tutorial completado!' : step.title}
        </h1>
        {completed ? (
          <>
            <p>¡Enhorabuena! Has destruido la fortaleza enemiga y completado la práctica libre.</p>
            <p>
              Ya conoces todas las unidades y sus posibilidades en combate. Ahora estás preparado
              para enfrentarte a tu primer rival.
            </p>
            <p>¡Buena suerte y que comience la batalla!</p>
          </>
        ) : (
          <>
            {step.paragraphs.map((paragraph, index) => (
              <p key={`${step.id}-${index}`}>{paragraph}</p>
            ))}
            <p className="tutorial-instruction" aria-live="polite" aria-atomic="true">
              {step.instruction}
            </p>
          </>
        )}
      </div>
      <div className="tutorial-footer">
        {completed ? (
          <div className="tutorial-navigation">
            <button type="button" className="secondary-button" onClick={commands.startTutorial}>
              Repetir tutorial
            </button>
            <button type="button" className="confirm-button" onClick={commands.exitTutorial}>
              Volver al menú
            </button>
          </div>
        ) : (
          <>
            <nav className="tutorial-navigation" aria-label="Navegación del tutorial">
              <button
                id="tutorial-previous"
                type="button"
                className="secondary-button"
                disabled={tutorial.stepIndex === 0 || snapshot.animating}
                onClick={() => commands.navigateTutorial(-1)}
              >
                Anterior
              </button>
              <button
                id="tutorial-next"
                type="button"
                className="confirm-button"
                disabled={tutorial.stepIndex === TUTORIAL_STEPS.length - 1 || snapshot.animating}
                onClick={() => commands.navigateTutorial(1)}
              >
                Siguiente
              </button>
            </nav>
          </>
        )}
      </div>
    </aside>
  );
}
