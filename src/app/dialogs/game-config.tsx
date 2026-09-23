import { useEffect, useRef, useState } from 'react';
import { PIECE_NAMES } from '../../engine';
import { createClassicConfig } from '../../game-config';
import { mountLayoutPreview, type LayoutPreview } from '../../layout-preview';
import { TURN_TIMEOUT_LIMIT } from '../../match-clock';
import { recordTelemetry } from '../../playtest-telemetry';
import { INITIAL_LAYOUTS, createInitialPieces, type InitialLayout } from '../../setup';
import type { AiDifficulty, FortressHp } from '../../types';
import { GameSelect } from '../components/game-select';
import { RendererStatus } from '../components/renderer-status';
import { Button, IconButton } from '../components/ui/button';
import { useGame } from '../game-context';

type MatchClockValue = '' | 300 | 600 | 1200;
type TurnClockValue = '' | 30 | 60 | 120;

const FORTRESS_HP_OPTIONS: readonly { value: FortressHp; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];
const INITIAL_LAYOUT_OPTIONS: readonly { value: InitialLayout; label: string }[] =
  INITIAL_LAYOUTS.map(({ id, name }) => ({ value: id, label: name }));
const DIFFICULTY_OPTIONS: readonly { value: AiDifficulty; label: string }[] = [
  { value: 'recruit', label: 'Fácil' },
  { value: 'tactical', label: 'Medio' },
  { value: 'commander', label: 'Difícil' },
  { value: 'expert', label: 'Experto' },
];
const MATCH_CLOCK_OPTIONS: readonly { value: MatchClockValue; label: string }[] = [
  { value: '', label: 'Sin límite' },
  { value: 300, label: '5 minutos' },
  { value: 600, label: '10 minutos' },
  { value: 1200, label: '20 minutos' },
];
const TURN_CLOCK_OPTIONS: readonly { value: TurnClockValue; label: string }[] = [
  { value: '', label: 'Sin límite' },
  { value: 30, label: '30 segundos' },
  { value: 60, label: '1 minuto' },
  { value: 120, label: '2 minutos' },
];

export function ConfigDialog({ mode }: { mode: 'local' | 'machine' }) {
  const { snapshot, commands } = useGame();
  const { preferences } = snapshot;
  const [fortressHp, setFortressHp] = useState<FortressHp>(1);
  const [initialLayout, setInitialLayout] = useState<InitialLayout>(1);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('tactical');
  const [clock, setClock] = useState<MatchClockValue>('');
  const [turnClock, setTurnClock] = useState<TurnClockValue>('');
  const layout = INITIAL_LAYOUTS.find((candidate) => candidate.id === initialLayout)!;
  const pieces = createInitialPieces(fortressHp, initialLayout).filter(
    (piece) => piece.owner === 0,
  );

  function goBack() {
    if (snapshot.homeView) {
      commands.closeDialog();
      commands.setHomeView('new');
    } else {
      commands.openDialog({ kind: 'mode', initial: false });
    }
  }

  function startMatch() {
    const config = createClassicConfig({
      mode,
      difficulty,
      confirmation: preferences.confirmation,
      contextualHints: preferences.contextualHints,
      fixedBoard: preferences.fixedBoard,
      handoffScreen: preferences.handoffScreen,
      clockSeconds: clock || null,
      turnClockSeconds: turnClock || null,
      fortressHp,
      initialLayout,
    });
    recordTelemetry('match-start', {
      mode,
      fortressHp,
      initialLayout,
      clockSeconds: clock || null,
      turnClockSeconds: turnClock || null,
      difficulty: config.participants[1].difficulty ?? 'human',
      personality: config.participants[1].personality ?? 'human',
    });
    commands.startMatch(config);
  }

  return (
    <>
      <IconButton
        className="config-close"
        data-dialog-close
        label="Cerrar configuración"
        onClick={commands.closeDialog}
      >
        ×
      </IconButton>
      <span className="eyebrow">NUEVA PARTIDA</span>
      <h2>{mode === 'machine' ? 'Individual vs. IA' : 'Dos jugadores'}</h2>
      <div className="match-configuration mt-6 grid gap-6 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'machine' && (
            <div className="grid min-w-0 content-start gap-2">
              <label htmlFor="ai-difficulty">Dificultad</label>
              <GameSelect
                inputId="ai-difficulty"
                options={DIFFICULTY_OPTIONS}
                value={difficulty}
                onChange={setDifficulty}
              />
            </div>
          )}
          <div className="grid min-w-0 content-start gap-2">
            <label htmlFor="fortress-hp">Puntos de vida de la Fortaleza</label>
            <GameSelect
              inputId="fortress-hp"
              options={FORTRESS_HP_OPTIONS}
              value={fortressHp}
              onChange={setFortressHp}
            />
          </div>
        </div>
        <fieldset className="m-0 min-w-0 border-0 border-t border-solid border-line p-0 pt-5">
          <legend className="sr-only">Límites de tiempo</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <label htmlFor="turn-clock-setting">Tiempo por turno</label>
              <GameSelect
                inputId="turn-clock-setting"
                options={TURN_CLOCK_OPTIONS}
                value={turnClock}
                onChange={setTurnClock}
                describedBy="clock-description"
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <label htmlFor="match-clock-setting">Tiempo total</label>
              <GameSelect
                inputId="match-clock-setting"
                options={MATCH_CLOCK_OPTIONS}
                value={clock}
                onChange={setClock}
                describedBy="clock-description"
              />
            </div>
          </div>
          <p id="clock-description" className="mb-0 mt-3 text-xs leading-relaxed text-muted">
            Si agotas el tiempo de turno, la IA juega por ti. Si te ocurre {TURN_TIMEOUT_LIMIT}{' '}
            veces durante la partida, pierdes. El tiempo total es por jugador; agotarlo supone
            perder la partida. Puedes combinar ambos límites.
          </p>
        </fieldset>
        <div className="border-0 border-t border-solid border-line pt-5">
          <div className="layout-picker">
            <div className="layout-picker-choice">
              <div className="layout-picker-label">
                <label htmlFor="initial-layout">Disposición inicial</label>
                <GameSelect
                  inputId="initial-layout"
                  options={INITIAL_LAYOUT_OPTIONS}
                  value={initialLayout}
                  onChange={setInitialLayout}
                  describedBy="layout-description"
                />
              </div>
              <p
                id="layout-description"
                className="layout-description"
                data-layout-description
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {layout.description}
              </p>
            </div>
            <figure className="layout-preview">
              <figcaption id="layout-preview-title">Vista previa · {layout.name}</figcaption>
              <LayoutPreviewCanvas
                initialLayout={initialLayout}
                fortressHp={fortressHp}
                highContrast={preferences.highContrast}
              />
              <p id="layout-preview-orientation">
                Vista de Cian. Ámbar tiene la formación reflejada.
              </p>
            </figure>
            <div className="layout-composition">
              <h3 data-layout-count>{pieces.length} piezas por bando</h3>
              <dl id="layout-preview-roster" className="layout-roster">
                {Object.entries(PIECE_NAMES).map(([type, name]) => (
                  <div key={type}>
                    <dt>{name}</dt>
                    <dd>{pieces.filter((piece) => piece.type === type).length}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </div>
      <div className="dialog-actions">
        <Button data-back-menu onClick={goBack}>
          Volver
        </Button>
        <Button variant="primary" data-start-free onClick={startMatch}>
          Crear partida
        </Button>
      </div>
    </>
  );
}

function LayoutPreviewCanvas({
  initialLayout,
  fortressHp,
  highContrast,
}: {
  initialLayout: InitialLayout;
  fortressHp: FortressHp;
  highContrast: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<LayoutPreview | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const options = { initialLayout, fortressHp, highContrast };
    if (previewRef.current) previewRef.current.update(options);
    else previewRef.current = mountLayoutPreview(canvasRef.current, options);
  }, [initialLayout, fortressHp, highContrast]);
  useEffect(
    () => () => {
      previewRef.current?.destroy();
      previewRef.current = null;
    },
    [],
  );
  return (
    <>
      <canvas
        ref={canvasRef}
        data-layout-preview
        data-layout={initialLayout}
        role="img"
        aria-labelledby="layout-preview-title"
        aria-describedby="layout-preview-orientation layout-description layout-preview-roster"
      />
      <RendererStatus canvasRef={canvasRef} />
    </>
  );
}
