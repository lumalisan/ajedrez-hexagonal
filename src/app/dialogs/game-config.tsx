import { DialogClose } from '../components/dialog-close';
import { useEffect, useRef, useState } from 'react';
import { FACTIONS } from '../../factions';
import { PIECE_NAMES } from '../../engine';
import { createClassicConfig } from '../../game-config';
import { mountLayoutPreview, type LayoutPreview } from '../../layout-preview';
import { TURN_TIMEOUT_LIMIT } from '../../match-clock';
import {
  FACTION_OPTIONS,
  FORTRESS_HP_OPTIONS,
  INITIAL_LAYOUT_OPTIONS,
  MATCH_CLOCK_OPTIONS,
  TURN_CLOCK_OPTIONS,
  type MatchClockValue,
  type TurnClockValue,
} from '../../match-options';
import { recordTelemetry } from '../../playtest-telemetry';
import { INITIAL_LAYOUTS, createInitialPieces, type InitialLayout } from '../../setup';
import type { AiDifficulty, FortressHp } from '../../types';
import { GameSelect } from '../components/game-select';
import { RendererStatus } from '../components/renderer-status';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { OnlineAvailability, OnlineWaiting } from './online-dialogs';
import { useGame } from '../game-context';

const DIFFICULTY_OPTIONS: readonly { value: AiDifficulty; label: string }[] = [
  { value: 'recruit', label: 'Fácil' },
  { value: 'tactical', label: 'Medio' },
  { value: 'commander', label: 'Difícil' },
  { value: 'expert', label: 'Experto' },
];

export function ConfigDialog({ mode }: { mode: 'local' | 'machine' | 'private' }) {
  const { snapshot, commands } = useGame();
  const { preferences } = snapshot;
  const [fortressHp, setFortressHp] = useState<FortressHp>(1);
  const [initialLayout, setInitialLayout] = useState<InitialLayout>(3);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('tactical');
  const [faction, setFaction] = useState<'expansionist' | 'conservationist'>('expansionist');
  const [clock, setClock] = useState<MatchClockValue>('');
  const [turnClock, setTurnClock] = useState<TurnClockValue>('');
  const layout = INITIAL_LAYOUTS.find((candidate) => candidate.id === initialLayout)!;
  const pieces = createInitialPieces(fortressHp, initialLayout).filter(
    (piece) => piece.owner === 0,
  );

  function goBack() {
    if (mode === 'private') {
      commands.openDialog({ kind: 'online' });
      return;
    }
    if (snapshot.homeView) {
      commands.closeDialog();
      commands.setHomeView('new');
    } else {
      commands.openDialog({ kind: 'mode', initial: false });
    }
  }

  function startMatch() {
    if (mode === 'private') {
      commands.createPrivateMatch({
        faction,
        fortressHp,
        turnSeconds: turnClock,
        totalSeconds: clock,
        layout: initialLayout === 5 ? 5 : 3,
      });
      return;
    }
    const config = createClassicConfig({
      mode,
      difficulty,
      confirmation: preferences.confirmation,
      contextualHints: preferences.contextualHints,
      fixedBoard: preferences.fixedBoard,
      handoffScreen: preferences.handoffScreen,
      clockSeconds: mode === 'machine' ? null : clock || null,
      turnClockSeconds: mode === 'machine' ? null : turnClock || null,
      fortressHp,
      initialLayout,
      faction,
      openingDraw: true,
      playerNames: [snapshot.profile.name, 'Invitado'],
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

  if (
    mode === 'private' &&
    (snapshot.online.state.status === 'private-waiting' ||
      snapshot.online.state.status === 'searching')
  ) {
    return (
      <>
        <DialogClose label="Cerrar partida privada" className="dialog-corner-close" />
        <span className="eyebrow">BATALLA EN LÍNEA</span>
        <h2>Partida privada</h2>
        <OnlineWaiting />
      </>
    );
  }

  return (
    <>
      <DialogClose label="Cerrar configuración" className="dialog-corner-close config-close" />
      <span className="eyebrow">{mode === 'private' ? 'BATALLA EN LÍNEA' : 'NUEVA PARTIDA'}</span>
      <h2>
        {mode === 'private'
          ? 'Crear partida privada'
          : mode === 'machine'
            ? 'Individual Vs. Hexfortia'
            : 'Batalla local'}
      </h2>
      <div className="match-configuration mt-6 grid gap-6 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 content-start gap-2">
            <label htmlFor="player-faction">Bando</label>
            <GameSelect
              inputId="player-faction"
              value={faction}
              onChange={setFaction}
              options={FACTION_OPTIONS}
            />
          </div>
          {mode === 'machine' && (
            <div className="grid min-w-0 content-start gap-2">
              <label htmlFor="ai-difficulty">Nivel</label>
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
        {mode !== 'machine' && (
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
        )}
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
                />
              </div>
            </div>
            <figure className="layout-preview">
              <figcaption id="layout-preview-title">Vista previa · {layout.name}</figcaption>
              <LayoutPreviewCanvas
                initialLayout={initialLayout}
                fortressHp={fortressHp}
                highContrast={preferences.highContrast}
                faction={faction}
              />
              <p id="layout-preview-orientation">
                Vista de tu lado del tablero. El rival tiene la formación reflejada.
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
      {mode === 'private' && <OnlineAvailability />}
      <div className="dialog-actions">
        <Button
          data-back-menu
          disabled={mode === 'private' && snapshot.online.busy}
          onClick={goBack}
        >
          Volver
        </Button>
        <Button
          variant="primary"
          data-start-free
          loading={mode === 'private' && snapshot.online.busy}
          onClick={startMatch}
        >
          {mode === 'private' ? 'Crear partida privada' : 'Crear partida'}
        </Button>
      </div>
    </>
  );
}

export function PrivateJoinDialog() {
  const { snapshot, commands } = useGame();
  const [code, setCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const valid = /^[0-9]{6}$/.test(code);
  return (
    <section className="mt-6" aria-labelledby="private-join-title">
      <DialogClose label="Cerrar partida privada" className="dialog-corner-close" />
      <span className="eyebrow">BATALLA EN LÍNEA</span>
      <h2 id="private-join-title">Unirse a partida privada</h2>
      <p className="text-sm text-muted">Pide al creador el código numérico de seis cifras.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (valid) commands.joinPrivateMatch(code);
        }}
      >
        <label htmlFor="private-code">Código de la partida</label>
        <div className="mt-2 flex flex-wrap gap-3">
          <Input
            id="private-code"
            className="flex-1 basis-40"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            pattern="[0-9]{6}"
            value={code}
            placeholder="000000"
            aria-invalid={(attempted && !valid) || undefined}
            aria-describedby={attempted && !valid ? 'private-code-error' : undefined}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          />
          <Button type="submit" loading={snapshot.online.busy}>
            Unirse a partida privada
          </Button>
        </div>
        {attempted && !valid && (
          <p id="private-code-error" role="alert" className="text-sm text-danger">
            Introduce un código de seis cifras.
          </p>
        )}
      </form>
      <OnlineAvailability />
      <div className="dialog-actions">
        <Button
          disabled={snapshot.online.busy}
          onClick={() => commands.openDialog({ kind: 'online' })}
        >
          Volver
        </Button>
      </div>
    </section>
  );
}

function LayoutPreviewCanvas({
  initialLayout,
  fortressHp,
  highContrast,
  faction,
}: {
  initialLayout: InitialLayout;
  fortressHp: FortressHp;
  highContrast: boolean;
  faction: keyof typeof FACTIONS;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<LayoutPreview | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const options = {
      initialLayout,
      fortressHp,
      highContrast,
      playerColors: [FACTIONS[faction].color, '#ffb547'] as [string, string],
    };
    if (previewRef.current) previewRef.current.update(options);
    else previewRef.current = mountLayoutPreview(canvasRef.current, options);
  }, [initialLayout, fortressHp, highContrast, faction]);
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
        aria-describedby="layout-preview-orientation layout-preview-roster"
      />
      <RendererStatus canvasRef={canvasRef} />
    </>
  );
}
