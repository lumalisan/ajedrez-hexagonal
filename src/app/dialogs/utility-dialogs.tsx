import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Field, FieldControl, FieldLabel } from '../components/ui/field';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { outcomeText, PLAYER_NAMES } from '../../engine';
import { BattleProgressionPanel } from '../components/battle-progression';
import { calculateStatistics, matchDurationSeconds } from '../../match-record';
import {
  loadAcademyRecords,
  loadMatchHistory,
  loadPendingMatches,
  type AcademyRecord,
} from '../../match-storage';
import { revealedScenarioHints, scenarioLessonAt } from '../../scenarios';
import type { GamePreferences, ScenarioDefinition } from '../../types';
import { GameSelect } from '../components/game-select';
import { useGame } from '../game-context';
import { AchievementsDialog } from './achievements-dialog';
import { OpeningDrawDialog } from './opening-draw-dialog';
import { ProfileDialog } from './profile-dialog';
import { StoryDialog } from './story-dialog';
import { RankingDialog } from './ranking-dialog';
import { MatchClockNotice } from '../components/match-clock-notice';

const CONFIRMATION_OPTIONS: readonly {
  value: GamePreferences['confirmation'];
  label: string;
}[] = [
  { value: 'always', label: 'Siempre' },
  { value: 'critical', label: 'Solo críticas' },
  { value: 'quick', label: 'Rápida' },
];

const CONFIRMATION_HELP: Record<GamePreferences['confirmation'], string> = {
  always: 'Revisa y confirma cada orden antes de ejecutarla. Recomendado para aprender.',
  critical:
    'Los movimientos normales se ejecutan al elegir destino. Se pide confirmación al eliminar unidades, dañar fortalezas, sufrir una intercepción o transformar vehículos.',
  quick:
    'Mover y atacar se ejecutan al elegir destino, sin confirmación. Las transformaciones siguen pidiendo confirmación.',
};

export function UtilityDialogs() {
  const { snapshot, commands } = useGame();
  const dialog = snapshot.dialog;
  switch (dialog?.kind) {
    case 'story':
      return <StoryDialog />;
    case 'first-turn':
      return <OpeningDrawDialog player={dialog.player} />;
    case 'profile':
      return <ProfileDialog />;
    case 'settings':
      return <SettingsDialog />;
    case 'continue':
      return <ContinueDialog />;
    case 'history':
      return <HistoryDialog />;
    case 'achievements':
      return <AchievementsDialog />;
    case 'ranking':
      return <RankingDialog />;
    case 'abandon':
      return (
        <ConfirmationDialog
          eyebrow="ABANDONAR PARTIDA"
          title={
            snapshot.gameMode === 'online'
              ? '¿Rendirse en esta partida en línea?'
              : '¿Volver al inicio?'
          }
          confirmLabel={
            snapshot.activeScenario
              ? 'Salir del ejercicio'
              : snapshot.gameMode === 'online'
                ? 'Rendirse'
                : 'Guardar y salir'
          }
          confirmAttribute="data-confirm-abandon"
          onConfirm={commands.abandon}
          danger={snapshot.gameMode === 'online'}
        >
          <p>
            {snapshot.activeScenario
              ? 'Volverás al menú de inicio. Puedes empezar de nuevo el ejercicio cuando quieras; su posición actual no se guarda como partida pendiente.'
              : snapshot.gameMode === 'online'
                ? 'Rendirse concede la victoria al rival y finaliza la partida compartida. El reloj de una partida en línea continúa aunque cierres la pestaña.'
                : 'Volverás al menú de inicio. La partida se guardará durante 30 días para que puedas retomarla más adelante. Transcurrido ese plazo, se registrará como perdida.'}
          </p>
        </ConfirmationDialog>
      );
    case 'orientation-loss':
      return (
        <ConfirmationDialog
          eyebrow="ADVERTENCIA DE DERROTA"
          title="Este cambio de orientación te hará perder"
          cancelLabel="Cancelar acción"
          confirmLabel="Confirmar y perder la partida"
          confirmAttribute="data-confirm-orientation-loss"
          onConfirm={() => void commands.commitPending()}
          danger
        >
          <p>
            Será tu quinto turno consecutivo dedicado únicamente a cambiar la orientación de un
            asaltador o del cañón de un tanque. Si confirmas definitivamente, perderás la partida.
          </p>
          <p>Puedes cancelar y elegir otra acción.</p>
        </ConfirmationDialog>
      );
    case 'resign':
      return (
        <ConfirmationDialog
          eyebrow="CONFIRMAR RENDICIÓN"
          title={
            snapshot.gameMode === 'online'
              ? `${snapshot.profile.name} abandona la batalla`
              : `${PLAYER_NAMES[snapshot.state.activePlayer]} abandona la batalla`
          }
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
          onConfirm={commands.offerDraw}
        >
          <p>La partida terminará en tablas únicamente si el rival acepta la propuesta.</p>
        </ConfirmationDialog>
      );
    case 'blockade':
      return (
        <ConfirmationDialog
          eyebrow="PROPUESTA DE TABLAS"
          title={`${PLAYER_NAMES[snapshot.online.state.status === 'playing' ? (snapshot.online.state.drawOffer ?? snapshot.state.activePlayer) : snapshot.state.activePlayer]} propone tablas`}
          icon="≋"
          cancelLabel="Rechazar"
          confirmLabel={`Aceptar como ${PLAYER_NAMES[snapshot.online.state.status === 'playing' ? snapshot.online.state.player : snapshot.state.activePlayer === 0 ? 1 : 0]}`}
          confirmAttribute="data-accept-blockade"
          onConfirm={() => {
            if (snapshot.gameMode !== 'online') commands.closeDialog();
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
            <Button
              type="button"
              variant="primary"
              data-handoff-ready
              onClick={commands.readyForTurn}
            >
              Estoy listo
            </Button>
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
        <Button type="button" variant="secondary" data-dialog-close onClick={commands.closeDialog}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          {...{ [confirmAttribute]: true }}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}

function SettingsDialog() {
  const { snapshot, commands } = useGame();
  const { matchRecord, animating } = snapshot;
  const [preferences, setPreferences] = useState(snapshot.preferences);
  const updateDraft = (update: Partial<GamePreferences>) =>
    setPreferences((current) => ({ ...current, ...update }));
  const importInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <DialogClose label="Cerrar ajustes sin guardar" className="dialog-corner-close" />
      <span className="eyebrow">OPCIONES</span>
      <h2>Audio, vista y accesibilidad</h2>
      <p>Personaliza la partida y guarda los cambios cuando termines.</p>
      <MatchClockNotice />
      <div className="volume-settings" aria-label="Controles de volumen">
        <VolumeControl
          preferences={preferences}
          onChange={updateDraft}
          preference="masterVolume"
          label="Volumen maestro"
          description="Controla toda la mezcla"
        />
        <VolumeControl
          preferences={preferences}
          onChange={updateDraft}
          preference="musicVolume"
          label="Música"
          description="Tema ambiental en bucle"
        />
        <VolumeControl
          preferences={preferences}
          onChange={updateDraft}
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
          onChange={(fixedBoard) => updateDraft({ fixedBoard })}
        />
        <div className="grid gap-2 px-3 py-2 text-sm">
          <label htmlFor="confirmation">Confirmación de órdenes</label>
          <GameSelect
            inputId="confirmation"
            options={CONFIRMATION_OPTIONS}
            value={preferences.confirmation}
            onChange={(confirmation) => updateDraft({ confirmation })}
            describedBy="confirmation-help"
          />
          <p id="confirmation-help" className="m-0 leading-relaxed" aria-live="polite">
            {CONFIRMATION_HELP[preferences.confirmation]} El movimiento del tanque y las órdenes que
            provocan una derrota por orientación siempre requieren confirmación.
          </p>
        </div>
        <TogglePreference
          label="Pantalla de entrega"
          description="Oculta la posición entre turnos locales"
          attribute="handoff"
          checked={preferences.handoffScreen}
          onChange={(handoffScreen) => updateDraft({ handoffScreen })}
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
          onChange={(highContrast) => updateDraft({ highContrast })}
        />
        <TogglePreference
          label="Animar fichas en reposo"
          description="Anima las fichas mientras esperan. No afecta a movimientos ni ataques."
          attribute="idle-animations"
          checked={preferences.idleAnimations}
          onChange={(idleAnimations) => updateDraft({ idleAnimations })}
        />
        <TogglePreference
          label="Reducir movimiento"
          description="Limita animaciones y transiciones"
          attribute="motion"
          checked={preferences.reducedMotion}
          onChange={(reducedMotion) => updateDraft({ reducedMotion })}
        />
      </div>
      <div className="board-settings">
        <div>
          <span className="eyebrow">PARTIDAS</span>
          <p>Guarda, carga y revisa tus partidas.</p>
        </div>
        <div className="inline-actions">
          <Button
            type="button"
            variant="secondary"
            data-export-match
            disabled={!matchRecord}
            onClick={commands.exportMatch}
          >
            Exportar partida
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-import-match
            disabled={animating}
            onClick={() => importInput.current?.click()}
          >
            Importar partida
          </Button>
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
      <details className="board-controls-help">
        <summary>Cómo controlar el tablero</summary>
        <p>
          Selecciona una unidad y después una casilla resaltada. Arrastra para desplazar la vista;
          usa la rueda del ratón o un gesto de pinza con dos dedos para acercar y alejar.
        </p>
        <p>Con el foco en el tablero, también puedes usar el teclado:</p>
        <dl className="board-shortcuts">
          <div>
            <dt>Q W E / A S D</dt>
            <dd>Recorrer las seis direcciones</dd>
          </div>
          <div>
            <dt>Intro o espacio</dt>
            <dd>Seleccionar casilla</dd>
          </div>
          <div>
            <dt>U / Mayús + U</dt>
            <dd>Siguiente / anterior unidad propia</dd>
          </div>
          <div>
            <dt>Esc</dt>
            <dd>Cancelar la orden preparada</dd>
          </div>
          <div>
            <dt>C</dt>
            <dd>Centrar el tablero</dd>
          </div>
          <div>
            <dt>H / L</dt>
            <dd>Abrir reglas / alternar registro</dd>
          </div>
        </dl>
      </details>
      <div className="dialog-actions">
        <Button data-cancel-preferences onClick={commands.closeDialog}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          data-save-preferences
          onClick={() => {
            commands.updatePreferences(preferences);
            commands.closeDialog();
          }}
        >
          Guardar cambios
        </Button>
      </div>
    </>
  );
}

function VolumeControl({
  preferences,
  onChange,
  preference,
  label,
  description,
}: {
  preferences: GamePreferences;
  onChange: (update: Partial<GamePreferences>) => void;
  preference: 'masterVolume' | 'musicVolume' | 'effectsVolume';
  label: string;
  description: string;
}) {
  const percentage = Math.round(preferences[preference] * 100);
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
        aria-valuetext={`${percentage}%`}
        onChange={(event) => onChange({ [preference]: Number(event.currentTarget.value) / 100 })}
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
  const id = useId();
  return (
    <Field>
      <FieldLabel className="toggle-row">
        <span>
          <strong id={`${id}-label`}>{label}</strong>
          <small id={`${id}-description`} className="font-normal">
            {description}
          </small>
        </span>
        <FieldControl>
          <Checkbox
            data-pref={attribute}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            checked={checked}
            onCheckedChange={(value) => onChange(value === true)}
          />
        </FieldControl>
      </FieldLabel>
    </Field>
  );
}

function ContinueDialog() {
  const { commands } = useGame();
  const [pending] = useState(loadPendingMatches);
  return (
    <>
      <DialogClose label="Cerrar partidas pendientes" className="dialog-corner-close" />
      <h2>Continuar partida</h2>
      <p>
        Elige la batalla que quieres retomar. Tras 30 días sin retomarla, se registra como perdida.
      </p>
      <div className="history-list">
        {pending.length ? (
          pending.map(({ record, resumedAt }) => (
            <button
              type="button"
              className="history-card"
              key={record.createdAt}
              data-continue-match={record.createdAt}
              onClick={() => commands.continueMatch(record.createdAt)}
            >
              <time dateTime={resumedAt}>
                {new Date(resumedAt).toLocaleString('es-ES', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              <strong>{record.config.participants.map((p) => p.name).join(' vs. ')}</strong>
              <small>
                {record.currentAction} órdenes ·{' '}
                {record.config.participants.some((p) => p.kind === 'machine')
                  ? 'Contra la IA'
                  : 'Dos jugadores'}
              </small>
              <small>Retomar partida</small>
            </button>
          ))
        ) : (
          <div className="empty-state">
            <strong>No hay partidas pendientes</strong>
            <p>Las partidas que abandones se guardarán aquí.</p>
            <Button
              variant="primary"
              onClick={() => {
                commands.closeDialog();
                commands.setHomeView('new');
              }}
            >
              Nueva partida
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function HistoryDialog() {
  const { commands } = useGame();
  const [history] = useState(loadMatchHistory);
  return (
    <>
      <DialogClose label="Cerrar historial" className="dialog-corner-close " />
      <span className="eyebrow">HISTORIAL LOCAL</span>
      <h2>Batallas concluidas</h2>
      <p>
        Selecciona una partida para ver su repetición. Los registros antiguos pueden contener solo
        el resultado.
      </p>
      <div className="history-list">
        {history.length ? (
          history.map((entry) => (
            <button
              type="button"
              className="history-card"
              key={entry.id}
              disabled={!entry.record}
              data-history-replay={entry.id}
              onClick={() => {
                if (entry.record) commands.openHistoryReplay(entry.record);
              }}
            >
              <time dateTime={entry.completedAt}>
                {new Date(entry.completedAt).toLocaleString('es-ES', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
              <strong>{outcomeText(entry.outcome)}</strong>
              <small>
                {entry.participants.join(' vs. ')} · {entry.plies} órdenes ·{' '}
                {formatDuration(entry.durationSeconds)}
              </small>
              <small>{entry.record ? 'Ver repetición' : 'Repetición no disponible'}</small>
            </button>
          ))
        ) : (
          <div className="empty-state">
            <strong>Aún no hay resultados</strong>
            <p>Termina una partida libre para inaugurar el archivo.</p>
            <Button
              variant="primary"
              onClick={() => {
                commands.closeDialog();
                commands.setHomeView('new');
              }}
            >
              Nueva partida
            </Button>
          </div>
        )}
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
  const evidence = matchRecord ? snapshot.progression.matches[matchRecord.createdAt] : undefined;
  const duration = matchRecord ? matchDurationSeconds(matchRecord) : 0;
  if (!state.outcome) return null;
  const winnerClass =
    state.outcome.type === 'win' ? (state.outcome.winner === 0 ? 'blue' : 'amber') : 'draw';
  return (
    <>
      <div className={`outcome-seal ${winnerClass}`}>
        <i />
      </div>
      <span className="eyebrow">BATALLA CONCLUIDA</span>
      <h2>{outcomeText(state.outcome)}</h2>
      <button
        type="button"
        className="history-card battle-record"
        data-analyze
        disabled={!matchRecord}
        onClick={() => commands.openReplay()}
        aria-label="Ver repetición de esta partida"
      >
        <span className="battle-record-stats">
          <span>
            <strong>{Math.ceil((state.ply + (state.passedTurnCount ?? 0)) / 2)}</strong> turnos
          </span>
          <span>
            <strong>{formatDuration(duration)}</strong> duración
          </span>
          <span>
            <strong>{statistics?.captures[0] ?? 0}</strong> unidades eliminadas por{' '}
            {matchRecord?.config.participants[0].name ?? snapshot.profile.name}
          </span>
          <span>
            <strong>{statistics?.captures[1] ?? 0}</strong> unidades eliminadas por{' '}
            {matchRecord?.config.participants[1].name ??
              (snapshot.gameMode === 'machine' ? 'Hexfortia' : 'Invitado')}
          </span>
        </span>
        <small>Ver repetición →</small>
      </button>
      <BattleProgressionPanel
        key={matchRecord?.createdAt}
        battle={evidence?.battle}
        mode={
          evidence?.mode ??
          (snapshot.gameMode === 'online'
            ? 'online'
            : snapshot.gameMode === 'machine'
              ? 'machine'
              : 'local')
        }
      />
      {snapshot.isLocalMatch && snapshot.canUndo && (
        <div className="inline-actions">
          <button type="button" className="text-button" data-undo-match onClick={commands.undo}>
            Deshacer última orden
          </button>
        </div>
      )}
      <div className="dialog-actions">
        <Button
          type="button"
          variant="secondary"
          data-rematch
          hidden={snapshot.gameMode === 'online'}
          onClick={() => {
            commands.closeDialog();
            commands.resetGame();
          }}
        >
          Revancha
        </Button>
        <Button
          type="button"
          variant="primary"
          data-new-game
          onClick={() => {
            commands.closeDialog();
            commands.showHome();
          }}
        >
          Volver al menú
        </Button>
      </div>
    </>
  );
}

function ScenarioBriefingDialog({ scenario }: { scenario: ScenarioDefinition }) {
  const { snapshot, commands } = useGame();
  const hintsId = useId();
  const hints = revealedScenarioHints(scenario, snapshot.scenarioHintsRevealed);
  const allHintsRevealed = hints.length >= scenario.hints.length;
  return (
    <div className="scenario-briefing">
      <div
        className="scenario-briefing-content flex min-h-0 flex-col gap-7 overflow-y-auto overscroll-contain p-6 sm:p-8"
        role="region"
        aria-label="Instrucciones del ejercicio"
        tabIndex={0}
      >
        <div className="flex flex-col gap-3">
          <span className="eyebrow">INSTRUCCIÓN TÁCTICA</span>
          <h2 className="m-0 font-heading text-2xl leading-tight font-semibold text-balance sm:text-3xl">
            {scenario.title}
          </h2>
        </div>

        <section aria-label="Objetivo del ejercicio" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h3 className="m-0 text-sm font-semibold text-accent">Objetivo</h3>
            <span className="text-sm text-muted">
              {scenario.maxPlies ? `Límite: ${scenario.maxPlies} órdenes` : 'Sin límite estricto'}
            </span>
          </div>
          <p className="m-0 text-lg leading-relaxed font-medium text-ink">{scenario.summary}</p>
          <p className="m-0 text-base leading-relaxed text-muted">
            {scenarioLessonAt(scenario, 0)}
          </p>
        </section>

        <section
          aria-label="Pistas opcionales"
          className="flex flex-col items-start gap-4 border-0 border-t border-solid border-line pt-6"
        >
          <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h3 className="m-0 text-base font-semibold text-ink">Pistas opcionales</h3>
            <span className="text-sm text-muted">
              {hints.length} de {scenario.hints.length} reveladas
            </span>
          </div>
          <p className="m-0 text-sm leading-relaxed text-muted">
            Intenta leer la posición primero. Si te atascas, revela las pistas de una en una.
          </p>
          <div
            id={hintsId}
            aria-live="polite"
            aria-relevant="additions"
            className="w-full empty:hidden"
          >
            {hints.length > 0 && (
              <ol
                className="scenario-steps m-0 gap-3 pl-6 text-sm leading-relaxed text-ink marker:text-accent"
                data-hint-list
              >
                {hints.map((hint, index) => (
                  <li key={`${index}-${hint}`} className="pl-1">
                    {hint}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <Button
            variant="secondary"
            data-reveal-scenario-hint
            aria-controls={hintsId}
            disabled={allHintsRevealed}
            onClick={() => commands.revealHint(scenario)}
          >
            {allHintsRevealed
              ? 'Todas las pistas reveladas'
              : hints.length
                ? 'Revelar otra pista'
                : 'Revelar primera pista'}
          </Button>
        </section>

        <p className="m-0 text-sm leading-relaxed text-muted">
          El objetivo y la etapa vigente seguirán visibles sobre el tablero. Una orden alternativa
          ya no reinicia la misión.
        </p>
      </div>
      <footer className="scenario-briefing-actions flex shrink-0 flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-line bg-panel px-6 py-5 sm:px-8">
        <ScenarioMenuButton>Volver al inicio</ScenarioMenuButton>
        <Button
          variant="primary"
          className="flex-1 sm:flex-none"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          Empezar ejercicio
        </Button>
      </footer>
    </div>
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
        <Button
          type="button"
          variant="secondary"
          data-retry-scenario
          onClick={() => commands.startScenario(scenario)}
        >
          Repetir
        </Button>
        <ScenarioMenuButton primary>Volver al inicio</ScenarioMenuButton>
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
        <ScenarioMenuButton>Volver al inicio</ScenarioMenuButton>
        <Button
          type="button"
          variant="primary"
          data-retry-scenario
          onClick={() => commands.startScenario(scenario)}
        >
          Reintentar
        </Button>
      </div>
    </>
  );
}

function ScenarioMenuButton({
  primary = false,
  children,
}: {
  primary?: boolean;
  children: ReactNode;
}) {
  const { commands } = useGame();
  return (
    <Button
      type="button"
      variant={primary ? 'primary' : 'secondary'}
      data-scenario-menu
      onClick={commands.abandon}
    >
      {children}
    </Button>
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
