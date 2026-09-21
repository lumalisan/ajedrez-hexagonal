import { useEffect, useRef, useState } from 'react';
import { PIECE_NAMES } from '../../engine';
import { mountLayoutPreview, type LayoutPreview } from '../../layout-preview';
import { MATCH_PRESETS, createPresetConfig, type MatchPresetId } from '../../match-presets';
import { recordTelemetry } from '../../playtest-telemetry';
import { INITIAL_LAYOUTS, createInitialPieces, type InitialLayout } from '../../setup';
import type { AiDifficulty, FortressHp } from '../../types';
import { useGame } from '../game-context';

export function ConfigDialog({ mode }: { mode: 'local' | 'machine' }) {
  const { snapshot, commands } = useGame();
  const { preferences } = snapshot;
  const [preset, setPreset] = useState<MatchPresetId>('tactical');
  const [fortressHp, setFortressHp] = useState<FortressHp>(2);
  const [initialLayout, setInitialLayout] = useState<InitialLayout>(1);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('tactical');
  const [clock, setClock] = useState('');
  const customOptionsRef = useRef<HTMLDivElement>(null);
  const layout = INITIAL_LAYOUTS.find((candidate) => candidate.id === initialLayout)!;
  const pieces = createInitialPieces(fortressHp, initialLayout).filter(
    (piece) => piece.owner === 0,
  );

  useEffect(() => {
    if (preset !== 'custom') return;
    const frame = window.requestAnimationFrame(() => {
      customOptionsRef.current?.scrollIntoView({
        behavior: preferences.reducedMotion ? 'auto' : 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preset, preferences.reducedMotion]);

  function selectPreset(id: MatchPresetId) {
    setPreset(id);
    if (id === 'skirmish' && !clock) setClock('600');
  }

  function goBack() {
    if (snapshot.homeView) {
      commands.closeDialog();
      commands.setHomeView('new');
    } else {
      commands.openDialog({ kind: 'mode', initial: false });
    }
  }

  function startMatch() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const config = createPresetConfig(preset, {
      mode,
      difficulty,
      seed,
      confirmation: preferences.confirmation,
      contextualHints: preferences.contextualHints,
      fixedBoard: preferences.fixedBoard,
      handoffScreen: preferences.handoffScreen,
      clockSeconds: clock ? Number(clock) : null,
      fortressHp,
      initialLayout,
    });
    recordTelemetry('match-start', {
      mode,
      preset,
      difficulty: config.participants[1].difficulty ?? 'human',
      personality: config.participants[1].personality ?? 'human',
    });
    commands.startMatch(config);
  }

  return (
    <>
      <button
        type="button"
        className="config-close"
        data-dialog-close
        aria-label="Cerrar configuración"
        onClick={commands.closeDialog}
      >
        ×
      </button>
      <span className="eyebrow">NUEVA PARTIDA</span>
      <h2>{mode === 'machine' ? 'Individual vs. IA' : 'Dos jugadores'}</h2>
      <p>Elige el ritmo primero. Siempre podrás afinar los detalles con la opción personalizada.</p>
      <div className="preset-grid" role="radiogroup" aria-label="Ritmo de partida">
        {MATCH_PRESETS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`preset-card ${candidate.id === preset ? 'selected' : ''}`}
            role="radio"
            aria-checked={candidate.id === preset}
            data-preset={candidate.id}
            onClick={() => selectPreset(candidate.id)}
          >
            <span className="preset-badge">{candidate.duration}</span>
            <strong>{candidate.name}</strong>
            <small>{candidate.description}</small>
          </button>
        ))}
      </div>
      <div
        ref={customOptionsRef}
        className="match-options"
        data-custom-options
        hidden={preset !== 'custom'}
      >
        <span className="eyebrow">AJUSTES PERSONALIZADOS</span>
        <label className="field-row">
          <span>Puntos de vida de la Fortaleza</span>
          <select
            data-fortress-hp
            value={fortressHp}
            onChange={(event) => setFortressHp(Number(event.currentTarget.value) as FortressHp)}
          >
            <option value="1">1 · partida explosiva</option>
            <option value="2">2 · equilibrio recomendado</option>
            <option value="3">3</option>
          </select>
        </label>
        <div className="layout-picker">
          <div className="layout-picker-choice">
            <label className="layout-picker-label">
              <span>Disposición inicial</span>
              <select
                data-initial-layout
                value={initialLayout}
                onChange={(event) =>
                  setInitialLayout(Number(event.currentTarget.value) as InitialLayout)
                }
              >
                {INITIAL_LAYOUTS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
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
              active={preset === 'custom'}
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
      {mode === 'machine' && (
        <div className="match-options">
          <span className="eyebrow">MANDO RIVAL</span>
          <div className="field-row">
            <label htmlFor="ai-difficulty">Dificultad</label>
            <select
              id="ai-difficulty"
              data-ai-difficulty
              aria-describedby="ai-difficulty-description"
              value={difficulty}
              onChange={(event) => setDifficulty(event.currentTarget.value as AiDifficulty)}
            >
              <option value="recruit">Fácil</option>
              <option value="tactical">Media</option>
              <option value="commander">Difícil</option>
              <option value="expert">Experto</option>
            </select>
          </div>
          <p className="dialog-note" id="ai-difficulty-description">
            Cuanto mayor sea la dificultad, más tiempo dedica la IA a anticipar tus respuestas.
          </p>
        </div>
      )}
      <div className="match-options">
        <span className="eyebrow">RELOJ POR JUGADOR</span>
        <label className="field-row">
          <span>Tiempo</span>
          <select
            data-match-clock
            value={clock}
            onChange={(event) => setClock(event.currentTarget.value)}
          >
            <option value="">Sin límite</option>
            <option value="300">5 minutos</option>
            <option value="600">10 minutos</option>
            <option value="1200">20 minutos</option>
          </select>
        </label>
        <p className="dialog-note">
          El reloj es real, se guarda con la partida y la derrota por tiempo queda registrada.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" data-back-menu onClick={goBack}>
          Volver
        </button>
        <button type="button" className="confirm-button" data-start-free onClick={startMatch}>
          Crear partida
        </button>
      </div>
    </>
  );
}

function LayoutPreviewCanvas({
  active,
  initialLayout,
  fortressHp,
  highContrast,
}: {
  active: boolean;
  initialLayout: InitialLayout;
  fortressHp: FortressHp;
  highContrast: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<LayoutPreview | null>(null);
  useEffect(() => {
    if (!active) {
      previewRef.current?.destroy();
      previewRef.current = null;
      return;
    }
    if (!canvasRef.current) return;
    const options = { initialLayout, fortressHp, highContrast };
    if (previewRef.current) previewRef.current.update(options);
    else previewRef.current = mountLayoutPreview(canvasRef.current, options);
  }, [active, initialLayout, fortressHp, highContrast]);
  useEffect(
    () => () => {
      previewRef.current?.destroy();
      previewRef.current = null;
    },
    [],
  );
  return (
    <canvas
      ref={canvasRef}
      data-layout-preview
      data-layout={initialLayout}
      role="img"
      aria-labelledby="layout-preview-title"
      aria-describedby="layout-preview-orientation layout-description layout-preview-roster"
    />
  );
}
