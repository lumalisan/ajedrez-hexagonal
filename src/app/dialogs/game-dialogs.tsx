import { Button } from '../components/ui/button';
import { useState } from 'react';
import {
  loadAcademyProgress,
  loadAcademyRecords,
  loadActiveMatch,
  type AcademyRecord,
} from '../../match-storage';
import { SCENARIOS, dailyScenarioForDate, scenariosByCategory } from '../../scenarios';
import type { ScenarioDefinition } from '../../types';
import { useGame } from '../game-context';
import { ConfigDialog } from './game-config';
import { RulesDialog } from './game-rules';

export function GameDialogs() {
  const { snapshot } = useGame();
  switch (snapshot.dialog?.kind) {
    case 'config':
      return <ConfigDialog key={snapshot.dialog.mode} mode={snapshot.dialog.mode} />;
    case 'mode':
      return <ModeDialog initial={snapshot.dialog.initial ?? false} />;
    case 'academy':
      return <AcademyDialog />;
    case 'rules':
      return <RulesDialog key={snapshot.dialog.sectionId} sectionId={snapshot.dialog.sectionId} />;
    default:
      return null;
  }
}

function ModeDialog({ initial }: { initial: boolean }) {
  const { commands } = useGame();
  const [saved] = useState(loadActiveMatch);
  const [completed] = useState(() => {
    const fixedIds = new Set(SCENARIOS.map((scenario) => scenario.id));
    return new Set(loadAcademyProgress().filter((id) => fixedIds.has(id))).size;
  });

  return (
    <>
      <div className="dialog-icon">♟</div>
      <span className="eyebrow">{initial ? 'CENTRO DE MANDO' : 'NUEVA PARTIDA'}</span>
      <h2>Elige tu próxima misión</h2>
      <p>
        {saved.error
          ? `El guardado anterior se descartó: ${saved.error}`
          : 'Partida libre siempre está disponible; Academia es opcional.'}
      </p>
      {saved.record && (
        <button
          type="button"
          className="continue-card"
          data-continue-match
          onClick={() => {
            if (saved.record) commands.loadRecord(saved.record);
          }}
        >
          <strong>Continuar partida</strong>
          <small>
            {saved.record.currentAction} órdenes guardadas ·{' '}
            {saved.record.config.participants[0].name} vs {saved.record.config.participants[1].name}
          </small>
        </button>
      )}
      <div className="mode-choice" role="group" aria-label="Modo de juego">
        <button
          type="button"
          className="mode-card"
          data-game-mode="local"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'local' })}
        >
          <span className="mode-icon" aria-hidden="true">
            ♙ ♟
          </span>
          <strong>Partida libre local</strong>
          <small>Dos jugadores comparten este dispositivo y alternan turnos.</small>
        </button>
        <button
          type="button"
          className="mode-card featured"
          data-game-mode="machine"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'machine' })}
        >
          <span className="mode-icon" aria-hidden="true">
            ♙ ⬡
          </span>
          <strong>Partida libre vs IA</strong>
          <small>Elige entre Fácil, Medio, Difícil y Experto.</small>
        </button>
        <button
          type="button"
          className="mode-card academy-card"
          data-game-mode="academy"
          onClick={() => commands.openDialog({ kind: 'academy' })}
        >
          <span className="mode-icon" aria-hidden="true">
            ◎
          </span>
          <strong>Academia táctica</strong>
          <small>
            {completed} de {SCENARIOS.length} desafíos completados.
          </small>
        </button>
      </div>
      {!initial && (
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            data-dialog-close
            onClick={commands.closeDialog}
          >
            Cancelar
          </Button>
        </div>
      )}
    </>
  );
}

function AcademyDialog() {
  const { snapshot, commands } = useGame();
  const [completed] = useState(() => new Set(loadAcademyProgress()));
  const [records] = useState(
    () => new Map(loadAcademyRecords().map((record) => [record.id, record])),
  );
  const [daily] = useState(dailyScenarioForDate);
  const fixedCompleted = SCENARIOS.filter(
    (scenario) => records.get(scenario.id)?.completed ?? completed.has(scenario.id),
  ).length;
  const groups: Array<{
    id: NonNullable<ScenarioDefinition['category']>;
    title: string;
    description: string;
    scenarios: ScenarioDefinition[];
  }> = [
    {
      id: 'daily',
      title: 'Reto diario',
      description: 'La misma misión local para todo el día; vuelve mañana para una nueva semilla.',
      scenarios: [daily],
    },
    {
      id: 'basic',
      title: 'Fundamentos',
      description: 'Una mecánica, una decisión clara.',
      scenarios: scenariosByCategory('basic'),
    },
    {
      id: 'guided',
      title: 'Batalla guiada',
      description: 'Combina piezas durante varios turnos con instrucciones por etapas.',
      scenarios: scenariosByCategory('guided'),
    },
    {
      id: 'strategic',
      title: 'Desafíos estratégicos',
      description: 'Objetivos abiertos para practicar tempo, defensa, protección y rutas.',
      scenarios: scenariosByCategory('strategic'),
    },
  ];

  function goBack() {
    if (snapshot.homeView) {
      commands.closeDialog();
      commands.setHomeView('main');
    } else {
      commands.openDialog({ kind: 'mode', initial: false });
    }
  }

  return (
    <div className="academy-shell">
      <header className="academy-hero">
        <button
          type="button"
          className="academy-close"
          data-back-menu
          aria-label="Cerrar Academia"
          onClick={goBack}
        >
          ×
        </button>
        <div className="academy-intro">
          <span className="eyebrow">ACADEMIA TÁCTICA</span>
          <h2>Aprende, combina y domina</h2>
          <p>
            Practica una idea cada vez. Las pistas aparecen solo cuando las necesitas y una orden
            distinta no reinicia el ejercicio.
          </p>
        </div>
        <div
          className="academy-progress"
          aria-label={`${fixedCompleted} de ${SCENARIOS.length} desafíos base completados`}
        >
          <div>
            <span>PROGRESO BASE</span>
            <strong>
              {fixedCompleted} / {SCENARIOS.length}
            </strong>
          </div>
          <progress max={SCENARIOS.length} value={fixedCompleted}>
            {fixedCompleted} de {SCENARIOS.length}
          </progress>
          <small>
            {fixedCompleted === SCENARIOS.length
              ? 'Entrenamiento base completado'
              : 'El reto diario cuenta por separado'}
          </small>
        </div>
      </header>
      <div className="academy-catalog">
        {groups.map((group) => (
          <section key={group.id} className="academy-section" data-academy-category={group.id}>
            <div className="academy-header">
              <div>
                <strong>{group.title}</strong>
                <small>{group.description}</small>
              </div>
              <span
                className="academy-count"
                aria-label={`${group.scenarios.length} ${group.scenarios.length === 1 ? 'misión' : 'misiones'}`}
              >
                {group.scenarios.length}
              </span>
            </div>
            <div className="scenario-list">
              {group.scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  record={records.get(scenario.id)}
                  legacyCompleted={completed.has(scenario.id)}
                />
              ))}
            </div>
          </section>
        ))}
        <div className="dialog-actions academy-actions">
          <Button type="button" variant="secondary" data-back-menu onClick={goBack}>
            Volver al menú
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  record,
  legacyCompleted,
}: {
  scenario: ScenarioDefinition;
  record: AcademyRecord | undefined;
  legacyCompleted: boolean;
}) {
  const { commands } = useGame();
  const completed = record?.completed ?? legacyCompleted;
  const medal = record?.medal ?? null;
  return (
    <button
      type="button"
      className="scenario-card"
      data-scenario={scenario.id}
      onClick={() => commands.startScenario(scenario)}
    >
      <span className={`medal ${medal ?? (completed ? 'bronze' : '')}`} aria-hidden="true">
        {medal === 'gold' ? '◆' : medal === 'silver' ? '◇' : completed ? '✓' : '○'}
      </span>
      <span className="scenario-card-copy">
        <strong>{scenario.title}</strong>
        <small>{scenario.summary}</small>
        <span className="scenario-meta">
          <span aria-label={`Dificultad ${scenario.difficulty ?? 1} de 3`}>
            Nivel {'◆'.repeat(scenario.difficulty ?? 1)}
          </span>
          <span>
            {record?.bestPlies
              ? `Mejor marca: ${record.bestPlies}`
              : completed
                ? 'Completado'
                : 'Sin completar'}
          </span>
        </span>
      </span>
    </button>
  );
}
