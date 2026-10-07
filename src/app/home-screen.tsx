import { useEffect, useRef, useState } from 'react';
import { loadActiveMatch, loadMatchHistory } from '../match-storage';
import { levelProgress, PROGRESSION_ACHIEVEMENTS } from '../progression';
import { useGame } from './game-context';
import { SettingsIcon, SoundButton } from './shell-icons';
import { MenuIcon } from './components/menu-icon';
import { ProfileAvatar } from './components/profile-avatar';

function readMenuSummary() {
  return {
    saved: loadActiveMatch(),
    history: loadMatchHistory(),
  };
}

export function HomeScreen() {
  const { snapshot, commands } = useGame();
  const menuRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(snapshot.homeView);
  const [{ saved, history }, setSummary] = useState(readMenuSummary);
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
              </nav>
              <nav className="home-shortcuts" aria-label="Explorar y personalizar">
                <button
                  type="button"
                  className="home-shortcut"
                  data-home-action="rules"
                  title="Consulta unidades, acciones y victoria"
                  onClick={() => commands.openDialog({ kind: 'rules' })}
                >
                  <MenuIcon kind="rules" />
                  <span>Reglas</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut"
                  data-home-action="tutorial"
                  title="Aprende paso a paso sobre el tablero"
                  onClick={commands.startTutorial}
                >
                  <MenuIcon kind="tutorial" />
                  <span>Tutorial</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut"
                  data-home-action="achievements"
                  title={`${Object.keys(snapshot.progression.unlockedAt).length} de ${PROGRESSION_ACHIEVEMENTS.length} hazañas desbloqueadas`}
                  onClick={() => commands.openDialog({ kind: 'achievements' })}
                >
                  <MenuIcon kind="achievements" />
                  <span>Logros</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut"
                  data-home-action="history"
                  title={
                    history.length
                      ? `${history.length} batallas concluidas`
                      : 'Tus resultados aparecerán aquí'
                  }
                  onClick={() => commands.openDialog({ kind: 'history' })}
                >
                  <MenuIcon kind="history" />
                  <span>Historial</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut"
                  id="home-settings-button"
                  aria-label="Abrir ajustes"
                  onClick={() => commands.openDialog({ kind: 'settings' })}
                >
                  <SettingsIcon />
                  <span>Ajustes</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut"
                  data-home-action="ranking"
                  onClick={() => commands.openDialog({ kind: 'ranking' })}
                >
                  <MenuIcon kind="ranking" />
                  <span>Clasificación</span>
                </button>
                <button
                  type="button"
                  className="home-shortcut home-shortcut-story"
                  data-home-action="story"
                  onClick={() => commands.openDialog({ kind: 'story' })}
                >
                  <MenuIcon kind="dilemma" />
                  <span>El dilema de Hexfortia</span>
                </button>
              </nav>
            </>
          )}
        </div>
        <button
          type="button"
          className="home-profile"
          data-home-action="profile"
          aria-label={`Editar perfil de ${snapshot.profile.name}`}
          onClick={() => commands.openDialog({ kind: 'profile' })}
        >
          <ProfileAvatar profile={snapshot.profile} />
          <span className="home-profile-copy">
            <strong>{snapshot.profile.name}</strong>
            <small>
              Nivel {levelProgress(snapshot.progression.xp).level} ·{' '}
              {levelProgress(snapshot.progression.xp).category}
            </small>
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" />
          </svg>
        </button>
      </aside>
      <div className="home-utility-actions" aria-label="Accesos rápidos">
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
