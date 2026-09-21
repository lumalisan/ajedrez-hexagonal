import { useMemo, useRef, useState, type ReactNode } from 'react';
import { outcomeText, PLAYER_NAMES } from '../../engine';
import { analyzeMatchMoments } from '../../match-insights';
import { calculateStatistics } from '../../match-record';
import { loadAcademyRecords, loadMatchHistory, type AcademyRecord } from '../../match-storage';
import { revealedScenarioHints, scenarioLessonAt } from '../../scenarios';
import type { GamePreferences, ScenarioDefinition } from '../../types';
import { useGame } from '../game-context';

export function UtilityDialogs() {
  const { snapshot, commands } = useGame();
  const dialog = snapshot.dialog;
  switch (dialog?.kind) {
    case 'settings':
      return <SettingsDialog />;
    case 'history':
      return <HistoryDialog />;
    case 'abandon':
      return (
        <ConfirmationDialog
          eyebrow="ABANDONAR PARTIDA"
          title="¿Volver al inicio?"
          confirmLabel="Abandonar partida"
          confirmAttribute="data-confirm-abandon"
          onConfirm={commands.abandon}
        >
          <p>La partida en curso se descartará y volverás al inicio.</p>
        </ConfirmationDialog>
      );
    case 'resign':
      return (
        <ConfirmationDialog
          eyebrow="CONFIRMAR RENDICIÓN"
          title={`${PLAYER_NAMES[snapshot.state.activePlayer]} abandona la batalla`}
          confirmLabel="Rendirse"
          confirmAttribute="data-confirm-resign"
          onConfirm={commands.resign}
          danger
        >
          <p>La victoria del rival quedará registrada y podrá revisarse en la repetición.</p>
        </ConfirmationDialog>
      );
    case 'draw-offer':
      return (
        <ConfirmationDialog
          eyebrow="PROPONER TABLAS"
          title="¿Proponer tablas al rival?"
          confirmLabel="Proponer tablas"
          confirmAttribute="data-confirm-draw-offer"
          onConfirm={() => commands.openDialog({ kind: 'blockade' })}
        >
          <p>La partida terminará en tablas únicamente si el rival acepta la propuesta.</p>
        </ConfirmationDialog>
      );
    case 'blockade':
      return (
        <ConfirmationDialog
          eyebrow="PROPUESTA DE TABLAS"
          title={`${PLAYER_NAMES[snapshot.state.activePlayer]} propone tablas`}
          icon="≋"
          cancelLabel="Rechazar"
          confirmLabel={`Aceptar como ${PLAYER_NAMES[snapshot.state.activePlayer === 0 ? 1 : 0]}`}
          confirmAttribute="data-accept-blockade"
          onConfirm={() => {
            commands.closeDialog();
            void commands.acceptBlockade();
          }}
        >
          <p>
            El rival debe aceptar. Según integridad actual, el resultado será:{' '}
            <strong>tablas</strong>.
          </p>
          <p className="dialog-warning">
            Aceptar no consume turno y finaliza inmediatamente la partida.
          </p>
        </ConfirmationDialog>
      );
    case 'outcome':
      return <OutcomeDialog />;
    case 'scenario-briefing':
      return <ScenarioBriefingDialog scenario={dialog.scenario} />;
    case 'scenario-success':
      return <ScenarioSuccessDialog scenario={dialog.scenario} />;
    case 'scenario-retry':
      return <ScenarioRetryDialog scenario={dialog.scenario} feedback={dialog.feedback} />;
    case 'handoff':
      return (
        <>
          <div className="dialog-icon">↻</div>
          <span className="eyebrow">CAMBIO DE MANDO</span>
          <h2>Entrega el dispositivo</h2>
          <p>
            Turno de{' '}
            <strong>
              {snapshot.matchConfig?.participants[snapshot.state.activePlayer].name ??
                PLAYER_NAMES[snapshot.state.activePlayer]}
            </strong>
            . La posición queda oculta hasta continuar.
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="confirm-button"
              data-handoff-ready
              onClick={commands.readyForTurn}
            >
              Estoy listo
            </button>
          </div>
        </>
      );
    default:
      return null;
  }
}

function ConfirmationDialog({
  eyebrow,
  title,
  icon,
  cancelLabel = 'Seguir jugando',
  confirmLabel,
  confirmAttribute,
  onConfirm,
  danger = false,
  children,
}: {
  eyebrow: string;
  title: string;
  icon?: string;
  cancelLabel?: string;
  confirmLabel: string;
  confirmAttribute: string;
  onConfirm: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  const { commands } = useGame();
  return (
    <>
      {icon && <div className="dialog-icon">{icon}</div>}
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirm-button${danger ? ' data-danger' : ''}`}
          {...{ [confirmAttribute]: true }}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

function SettingsDialog() {
  const { snapshot, commands } = useGame();
  const { preferences, matchRecord, animating, machineThinking } = snapshot;
  const importInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <span className="eyebrow">OPCIONES</span>
      <h2>Audio, vista y accesibilidad</h2>
      <p>Personaliza la partida. Los cambios se guardan automáticamente.</p>
      <div className="volume-settings" aria-label="Controles de volumen">
        <VolumeControl
          preference="masterVolume"
          label="Volumen maestro"
          description="Controla toda la mezcla"
        />
        <VolumeControl
          preference="musicVolume"
          label="Música"
          description="Tema ambiental en bucle"
        />
        <VolumeControl
          preference="effectsVolume"
          label="Efectos especiales"
          description="Movimientos, ataques y avisos"
        />
      </div>
      <div className="board-settings">
        <div>
          <span className="eyebrow">TABLERO Y ÓRDENES</span>
          <p>Configura la orientación y la confirmación durante la partida.</p>
        </div>
        <TogglePreference
          label="Mantener tablero fijo"
          description="Cian permanece abajo y Ámbar arriba durante toda la partida"
          attribute="fixed-board"
          checked={preferences.fixedBoard}
          onChange={(fixedBoard) => commands.updatePreferences({ fixedBoard })}
        />
        <label className="field-row">
          <span>Confirmación de órdenes</span>
          <select
            data-pref="confirmation"
            value={preferences.confirmation}
            onChange={(event) =>
              commands.updatePreferences({
                confirmation: event.currentTarget.value as GamePreferences['confirmation'],
              })
            }
          >
            <option value="always">Siempre</option>
            <option value="critical">Solo críticas</option>
            <option value="quick">Rápida</option>
          </select>
        </label>
        <TogglePreference
          label="Pantalla de entrega"
          description="Oculta la posición entre turnos locales"
          attribute="handoff"
          checked={preferences.handoffScreen}
          onChange={(handoffScreen) => commands.updatePreferences({ handoffScreen })}
        />
      </div>
      <div className="accessibility-settings">
        <div>
          <span className="eyebrow">ACCESIBILIDAD</span>
          <p>Adapta la presentación visual a tus necesidades.</p>
        </div>
        <TogglePreference
          label="Alto contraste"
          description="Refuerza bordes y colores del tablero"
          attribute="contrast"
          checked={preferences.highContrast}
          onChange={(highContrast) => commands.updatePreferences({ highContrast })}
        />
        <TogglePreference
          label="Reducir movimiento"
          description="Limita animaciones y transiciones"
          attribute="motion"
          checked={preferences.reducedMotion}
          onChange={(reducedMotion) => commands.updatePreferences({ reducedMotion })}
        />
      </div>
      <div className="board-settings">
        <div>
          <span className="eyebrow">PARTIDAS</span>
          <p>Guarda, carga y revisa tus partidas.</p>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            className="secondary-button"
            data-export-match
            disabled={!matchRecord}
            onClick={commands.exportMatch}
          >
            Exportar partida
          </button>
          <button
            type="button"
            className="secondary-button"
            data-import-match
            disabled={animating}
            onClick={() => importInput.current?.click()}
          >
            Importar partida
          </button>
          <button
            type="button"
            className="secondary-button"
            data-open-replay
            disabled={!matchRecord || animating || machineThinking}
            onClick={() => commands.openReplay()}
          >
            Ver repetición
          </button>
          <button
            type="button"
            className="secondary-button"
            data-history
            onClick={() => commands.openDialog({ kind: 'history' })}
          >
            Historial de resultados
          </button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          data-import-file
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void commands.importMatch(file);
          }}
        />
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="confirm-button"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          Listo
        </button>
      </div>
    </>
  );
}

function VolumeControl({
  preference,
  label,
  description,
}: {
  preference: 'masterVolume' | 'musicVolume' | 'effectsVolume';
  label: string;
  description: string;
}) {
  const { snapshot, commands } = useGame();
  const percentage = Math.round(snapshot.preferences[preference] * 100);
  return (
    <label className="volume-control">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={percentage}
        data-volume={preference}
        aria-label={label}
        onChange={(event) =>
          commands.updatePreferences({ [preference]: Number(event.currentTarget.value) / 100 })
        }
      />
      <output>{percentage}%</output>
    </label>
  );
}

function TogglePreference({
  label,
  description,
  attribute,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  attribute: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        data-pref={attribute}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function HistoryDialog() {
  const { snapshot, commands } = useGame();
  const [history] = useState(loadMatchHistory);
  return (
    <>
      <span className="eyebrow">HISTORIAL LOCAL</span>
      <h2>Batallas concluidas</h2>
      <p>Un registro breve de resultados; las repeticiones completas se exportan por separado.</p>
      <div className="history-list">
        {history.length ? (
          history.map((entry) => (
            <article className="history-card" key={entry.id}>
              <span>{new Date(entry.completedAt).toLocaleDateString('es-ES')}</span>
              <strong>{outcomeText(entry.outcome)}</strong>
              <small>
                {entry.participants.join(' vs. ')} · {entry.plies} órdenes ·{' '}
                {formatDuration(entry.durationSeconds)}
              </small>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <strong>Aún no hay resultados</strong>
            <p>Termina una partida libre para inaugurar el archivo.</p>
          </div>
        )}
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          data-history-back
          onClick={() => {
            if (snapshot.homeView) {
              commands.closeDialog();
              commands.setHomeView('main');
            } else commands.openDialog({ kind: 'settings' });
          }}
        >
          Volver
        </button>
        <button
          type="button"
          className="confirm-button"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          Listo
        </button>
      </div>
    </>
  );
}

function OutcomeDialog() {
  const { snapshot, commands } = useGame();
  const { state, matchRecord } = snapshot;
  const statistics = useMemo(
    () => (matchRecord ? calculateStatistics(matchRecord) : null),
    [matchRecord],
  );
  const moments = useMemo(
    () => (matchRecord ? analyzeMatchMoments(matchRecord) : []),
    [matchRecord],
  );
  if (!state.outcome) return null;
  const winnerClass =
    state.outcome.type === 'win' ? (state.outcome.winner === 0 ? 'blue' : 'amber') : 'draw';
  const remainingBlue = state.pieces.filter((piece) => piece.owner === 0).length;
  const remainingAmber = state.pieces.filter((piece) => piece.owner === 1).length;
  return (
    <>
      <div className={`outcome-seal ${winnerClass}`}>
        <i />
      </div>
      <span className="eyebrow">BATALLA CONCLUIDA</span>
      <h2>{outcomeText(state.outcome)}</h2>
      <div className="result-stats">
        <span>
          <strong>{Math.ceil(state.ply / 2)}</strong> turnos
        </span>
        <span>
          <strong>{remainingBlue}</strong> unidades Cian
        </span>
        <span>
          <strong>{remainingAmber}</strong> unidades Ámbar
        </span>
      </div>
      {statistics && (
        <p className="result-detail">
          Capturas {statistics.captures[0]}–{statistics.captures[1]} · Daño a Fortaleza{' '}
          {statistics.fortressDamage[0]}–{statistics.fortressDamage[1]} · Transformaciones{' '}
          {statistics.transformations[0]}–{statistics.transformations[1]}
        </p>
      )}
      {moments.length > 0 && (
        <section className="key-moments">
          <div>
            <span className="eyebrow">TRES MOMENTOS CLAVE</span>
            <p>Salta directamente a los giros que más cambiaron la batalla.</p>
          </div>
          {moments.map((moment) => (
            <button
              key={moment.actionIndex}
              type="button"
              className="moment-card"
              data-moment-jump={moment.actionIndex}
              onClick={() => commands.openReplay(moment.actionIndex)}
            >
              <span>Orden {moment.actionIndex}</span>
              <strong>{moment.title}</strong>
              <small>{moment.detail}</small>
            </button>
          ))}
        </section>
      )}
      {snapshot.isLocalMatch && snapshot.canUndo && (
        <div className="inline-actions">
          <button type="button" className="text-button" data-undo-match onClick={commands.undo}>
            Deshacer última orden
          </button>
        </div>
      )}
      <div className="dialog-actions triple">
        <button
          type="button"
          className="text-button"
          data-analyze
          onClick={() => commands.openReplay()}
        >
          Ver repetición
        </button>
        <button
          type="button"
          className="secondary-button"
          data-rematch
          onClick={() => {
            commands.closeDialog();
            commands.resetGame();
          }}
        >
          Revancha
        </button>
        <button
          type="button"
          className="confirm-button"
          data-new-game
          onClick={() => {
            commands.closeDialog();
            commands.showHome('new');
          }}
        >
          Nueva partida
        </button>
      </div>
    </>
  );
}

function ScenarioBriefingDialog({ scenario }: { scenario: ScenarioDefinition }) {
  const { snapshot, commands } = useGame();
  const hints = revealedScenarioHints(scenario, snapshot.scenarioHintsRevealed);
  const allHintsRevealed = hints.length >= scenario.hints.length;
  return (
    <>
      <span className="eyebrow">INSTRUCCIÓN TÁCTICA</span>
      <h2>{scenario.title}</h2>
      <p className="scenario-objective">
        <strong>Objetivo:</strong> {scenario.summary}
      </p>
      <div className="scenario-progress">
        <strong>{scenarioLessonAt(scenario, 0)}</strong>
        <span>
          {scenario.maxPlies ? `Límite: ${scenario.maxPlies} órdenes` : 'Sin límite estricto'}
        </span>
      </div>
      <div className="scenario-hint">
        <p>Intenta leer la posición primero. Si te atascas, revela las pistas de una en una.</p>
        <ol className="scenario-steps" data-hint-list>
          {hints.map((hint, index) => (
            <li key={`${index}-${hint}`}>{hint}</li>
          ))}
        </ol>
        <button
          type="button"
          className="text-button"
          data-reveal-scenario-hint
          disabled={allHintsRevealed}
          onClick={() => commands.revealHint(scenario)}
        >
          {allHintsRevealed
            ? 'Todas las pistas reveladas'
            : hints.length
              ? 'Revelar otra pista'
              : 'Revelar primera pista'}
        </button>
      </div>
      <p className="dialog-note">
        El objetivo y la etapa vigente seguirán visibles sobre el tablero. Una orden alternativa ya
        no reinicia la misión.
      </p>
      <div className="dialog-actions">
        <AcademyMenuButton>Volver</AcademyMenuButton>
        <button
          type="button"
          className="confirm-button"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          Empezar ejercicio
        </button>
      </div>
    </>
  );
}

function ScenarioSuccessDialog({ scenario }: { scenario: ScenarioDefinition }) {
  const { snapshot, commands } = useGame();
  const [record] = useState(() =>
    loadAcademyRecords().find((candidate) => candidate.id === scenario.id),
  );
  return (
    <>
      <div className="dialog-icon">
        {record?.medal === 'gold' ? '◆' : record?.medal === 'silver' ? '◇' : '✓'}
      </div>
      <span className="eyebrow">OBJETIVO COMPLETADO</span>
      <h2>{scenario.title}</h2>
      <p>{scenario.successText}</p>
      <div className="scenario-progress">
        <strong>{academyMedalLabel(record?.medal ?? null)}</strong>
        <span>
          {record?.bestPlies ?? snapshot.state.ply} órdenes · {snapshot.scenarioHintsRevealed}{' '}
          pistas usadas
        </span>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          data-retry-scenario
          onClick={() => commands.startScenario(scenario)}
        >
          Repetir
        </button>
        <AcademyMenuButton primary>Seguir entrenando</AcademyMenuButton>
      </div>
    </>
  );
}

function ScenarioRetryDialog({
  scenario,
  feedback,
}: {
  scenario: ScenarioDefinition;
  feedback: string;
}) {
  const { snapshot, commands } = useGame();
  const hints = revealedScenarioHints(scenario, Math.max(1, snapshot.scenarioHintsRevealed));
  return (
    <>
      <span className="eyebrow">REVISIÓN DEL EJERCICIO</span>
      <h2>La secuencia ha terminado</h2>
      <p>{feedback}</p>
      <p className="dialog-note">
        <strong>Objetivo:</strong> {scenario.summary}
      </p>
      <ol className="scenario-steps">
        {hints.map((hint, index) => (
          <li key={`${index}-${hint}`}>{hint}</li>
        ))}
      </ol>
      <div className="dialog-actions">
        <AcademyMenuButton>Elegir otro</AcademyMenuButton>
        <button
          type="button"
          className="confirm-button"
          data-retry-scenario
          onClick={() => commands.startScenario(scenario)}
        >
          Reintentar
        </button>
      </div>
    </>
  );
}

function AcademyMenuButton({
  primary = false,
  children,
}: {
  primary?: boolean;
  children: ReactNode;
}) {
  const { commands } = useGame();
  return (
    <button
      type="button"
      className={primary ? 'confirm-button' : 'secondary-button'}
      data-academy-menu
      onClick={() => commands.openDialog({ kind: 'academy' })}
    >
      {children}
    </button>
  );
}

function academyMedalLabel(medal: AcademyRecord['medal']): string {
  return medal === 'gold'
    ? 'Medalla de oro · sin pistas y ruta directa'
    : medal === 'silver'
      ? 'Medalla de plata · una pista'
      : medal === 'bronze'
        ? 'Medalla de bronce · objetivo cumplido'
        : 'Objetivo cumplido';
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} min ${remainder ? `${remainder} s` : ''}`.trim() : `${remainder} s`;
}
