import { useEffect, useRef, useState } from 'react';
import { loadAcademyProgress, loadActiveMatch, loadMatchHistory } from '../match-storage';
import { SCENARIOS } from '../scenarios';
import { ACHIEVEMENTS, achievementProgressFor } from '../achievements';
import { useGame } from './game-context';
import { SettingsIcon, SoundButton } from './shell-icons';

function readMenuSummary() {
  const ids = new Set(SCENARIOS.map((scenario) => scenario.id));
  return {
    saved: loadActiveMatch(),
    completed: new Set(loadAcademyProgress().filter((id) => ids.has(id))).size,
    history: loadMatchHistory(),
  };
}

export function HomeScreen() {
  const { snapshot, commands } = useGame();
  const menuRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(snapshot.homeView);
  const [{ saved, completed, history }, setSummary] = useState(readMenuSummary);
  useEffect(() => {
    if (snapshot.homeView === 'main' && !snapshot.dialog) setSummary(readMenuSummary());
  }, [snapshot.homeView, snapshot.dialog]);
  useEffect(() => {
    if (snapshot.homeView !== null && snapshot.homeView !== previousView.current) {
      const selector =
        snapshot.homeView === 'new' ? '[data-home-mode="machine"]' : '[data-home-action="new"]';
      menuRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    }
    previousView.current = snapshot.homeView;
  }, [snapshot.homeView]);
  const continueDetail = saved.record
    ? `${saved.record.currentAction} órdenes guardadas · ${saved.record.config.participants[0].name} vs. ${saved.record.config.participants[1].name}`
    : saved.error
      ? 'La última partida no se pudo recuperar'
      : 'No hay una partida guardada';
  return (
    <section
      id="home-screen"
      className="home-screen"
      aria-label="Portada de Protocolo Hexagonal"
      hidden={snapshot.homeView === null}
      inert={snapshot.homeView === null}
    >
      <aside className="home-menu-panel">
        <div className="home-brand">
          <img src="/atlas-mark.svg" alt="" width="58" height="58" />
          <div>
            <span>ESTRATEGIA HEXAGONAL</span>
            <h1>
              Protocolo
              <br />
              Hexagonal
            </h1>
          </div>
        </div>
        <div ref={menuRef} id="home-menu-content" className="home-menu-content">
          {snapshot.homeView === 'new' ? (
            <>
              <button
                type="button"
                className="home-back-button"
                data-home-action="back"
                aria-label="Volver al menú principal"
                onClick={() => commands.setHomeView('main')}
              >
                ← <span>Nueva partida</span>
              </button>
              <p className="home-intro">Elige cómo quieres disputar la batalla.</p>
              <nav className="home-navigation mode-navigation" aria-label="Tipo de partida">
                <button
                  type="button"
                  className="home-nav-button primary"
                  data-home-mode="machine"
                  onClick={() => commands.openDialog({ kind: 'config', mode: 'machine' })}
                >
                  <span>Individual vs. IA</span>
                  <small>Juega contra la inteligencia artificial</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-mode="local"
                  onClick={() => commands.openDialog({ kind: 'config', mode: 'local' })}
                >
                  <span>Dos jugadores</span>
                  <small>Juega contra otra persona en el mismo ordenador</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-mode="academy"
                  onClick={() => commands.openDialog({ kind: 'academy' })}
                >
                  <span>Academia táctica</span>
                  <small>
                    {completed} de {SCENARIOS.length} desafíos completados
                  </small>
                </button>
              </nav>
            </>
          ) : (
            <>
              <p className="home-intro">Domina el frente. Protege tu fortaleza.</p>
              <nav className="home-navigation" aria-label="Menú principal">
                <button
                  type="button"
                  className="home-nav-button primary"
                  data-home-action="new"
                  onClick={() => commands.setHomeView('new')}
                >
                  <span>Nueva partida</span>
                  <small>Configura un nuevo enfrentamiento</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  id="home-continue-button"
                  data-home-action="continue"
                  disabled={!saved.record}
                  onClick={commands.continueMatch}
                >
                  <span>Continuar partida</span>
                  <small id="home-continue-detail">{continueDetail}</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-action="rules"
                  onClick={() => commands.openDialog({ kind: 'rules' })}
                >
                  <span>Reglas</span>
                  <small>Consulta unidades, acciones y victoria</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-action="tutorial"
                  onClick={commands.startTutorial}
                >
                  <span>Tutorial</span>
                  <small>Aprende paso a paso sobre el tablero</small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-action="achievements"
                  onClick={() => commands.openDialog({ kind: 'achievements' })}
                >
                  <span>Logros</span>
                  <small>
                    {
                      ACHIEVEMENTS.filter(
                        (entry) => achievementProgressFor(entry, snapshot.achievements).unlocked,
                      ).length
                    }{' '}
                    de {ACHIEVEMENTS.length} hazañas desbloqueadas
                  </small>
                </button>
                <button
                  type="button"
                  className="home-nav-button"
                  data-home-action="history"
                  onClick={() => commands.openDialog({ kind: 'history' })}
                >
                  <span>Historial</span>
                  <small>
                    {history.length
                      ? `${history.length} batallas concluidas`
                      : 'Tus resultados aparecerán aquí'}
                  </small>
                </button>
              </nav>
            </>
          )}
        </div>
      </aside>
      <div className="home-utility-actions" aria-label="Accesos rápidos">
        <button
          className="icon-button"
          id="home-settings-button"
          type="button"
          aria-label="Abrir ajustes"
          title="Ajustes"
          onClick={() => commands.openDialog({ kind: 'settings' })}
        >
          <SettingsIcon />
          <span className="home-utility-label">Ajustes</span>
        </button>
        <SoundButton home />
      </div>
      <div className="demo-status" aria-hidden="true">
        <span className="demo-live-dot" />
        <span>Partida de demostración</span>
        <strong>IA Cian vs. IA Ámbar</strong>
      </div>
    </section>
  );
}
