import { useEffect, useId, useRef, useState } from 'react';
import { DialogClose } from '../components/dialog-close';
import { MenuIcon } from '../components/menu-icon';
import { Button } from '../components/ui/button';
import { useGame } from '../game-context';
import { useAccount } from '../account-context';

export function OnlineAvailability({ retrySearch = false }: { retrySearch?: boolean }) {
  const { snapshot, commands } = useGame();
  return (
    <>
      {!snapshot.online.available && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          El juego en línea aún no está conectado. Puedes jugar una batalla local mientras tanto.
        </p>
      )}
      {snapshot.online.error && (
        <div role="alert" className="mt-4 text-sm leading-relaxed text-danger">
          <p>{snapshot.online.error}</p>
          {snapshot.online.available && (
            <Button onClick={retrySearch ? commands.startOnlineSearch : commands.resumeOnline}>
              Reintentar conexión
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function OnlineWaiting({ publicSearch = false }: { publicSearch?: boolean }) {
  const { snapshot, commands } = useGame();
  const state = snapshot.online.state;
  if (!publicSearch && state.status !== 'searching' && state.status !== 'private-waiting')
    return null;
  const failed =
    publicSearch &&
    state.status === 'idle' &&
    !snapshot.online.busy &&
    (!snapshot.online.available || snapshot.online.error !== null);
  return (
    <div className="online-waiting mt-6 grid gap-6 py-6 text-center">
      {!failed && (
        <div className="grid justify-items-center gap-5">
          <div role="status" className="grid w-full justify-items-center gap-5">
            <img
              className="online-search-indicator"
              src="/atlas-mark.svg"
              width="80"
              height="80"
              alt=""
              aria-hidden="true"
            />
            <h3 className="m-0">Esperando rival…</h3>
          </div>
          {state.status === 'private-waiting' ? (
            <>
              <p className="m-0 text-sm text-muted">
                Comparte este código para que se unan a tu partida privada:
              </p>
              <PrivateRoomCode key={state.code} code={state.code} />
              <p className="m-0 text-xs text-muted">
                El código caduca a los 10 minutos. La partida comienza cuando se una tu rival.
              </p>
            </>
          ) : null}
        </div>
      )}
      <OnlineAvailability retrySearch={publicSearch && state.status === 'idle'} />
      <Button onClick={commands.cancelOnlineWaiting}>
        Cancelar {state.status === 'private-waiting' ? 'partida privada' : 'búsqueda'}
      </Button>
    </div>
  );
}

function PrivateRoomCode({ code }: { code: string }) {
  const [feedback, setFeedback] = useState({ status: 'idle', attempt: 0 });
  const mounted = useRef(false);
  const copying = useRef(false);
  const statusId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (feedback.status !== 'copied') return;
    const timer = setTimeout(() => {
      setFeedback((current) => ({ ...current, status: 'idle' }));
    }, 2600);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function copyCode() {
    if (copying.current) return;
    copying.current = true;
    try {
      await navigator.clipboard.writeText(code);
      if (mounted.current)
        setFeedback((current) => ({ status: 'copied', attempt: current.attempt + 1 }));
    } catch {
      if (mounted.current)
        setFeedback((current) => ({ status: 'error', attempt: current.attempt + 1 }));
    } finally {
      copying.current = false;
    }
  }

  return (
    <div
      className="online-room-code grid justify-items-center gap-2"
      data-copy-state={feedback.status}
    >
      <button
        type="button"
        className="online-code-button relative inline-flex min-h-control min-w-60 cursor-pointer items-center justify-center rounded-xl border border-solid border-line-strong bg-transparent px-5 py-3 text-ink transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent data-[copied=true]:border-accent data-[copied=true]:bg-accent/10 data-[copied=true]:text-accent"
        data-copied={feedback.status === 'copied'}
        aria-label={`Copiar código ${code.split('').join(' ')}`}
        aria-describedby={statusId}
        onClick={() => void copyCode()}
      >
        <span key={feedback.attempt} className="online-code-content flex items-center gap-3">
          <strong className="select-text font-heading text-4xl tabular-nums">{code}</strong>
          <svg
            className="online-code-symbol"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon
              className="online-code-hex"
              points="16,2 28,9 28,23 16,30 4,23 4,9"
              pathLength="1"
            />
            <g className="online-code-copy">
              <path d="M13 12V9h9v11h-3" />
              <rect x="10" y="12" width="9" height="11" rx="1" />
            </g>
            <path className="online-code-check" d="m10 16 4 4 8-8" pathLength="1" />
          </svg>
        </span>
      </button>
      <span
        id={statusId}
        role="status"
        aria-atomic="true"
        className="online-code-feedback text-xs leading-relaxed"
      >
        <span key={feedback.attempt}>
          {feedback.status === 'copied'
            ? '¡Código copiado!'
            : feedback.status === 'error'
              ? 'No se pudo copiar. Selecciona y copia el código.'
              : 'Pulsa para copiar'}
        </span>
      </span>
    </div>
  );
}

export function OnlineMenuDialog() {
  const { account } = useAccount();
  const { snapshot, commands } = useGame();
  return (
    <>
      <DialogClose label="Cerrar batalla en línea" className="dialog-corner-close" />
      <span className="eyebrow">NUEVA PARTIDA</span>
      <h2>Batalla en línea</h2>
      <p className="text-sm leading-relaxed text-muted">Elige cómo quieres jugar.</p>
      <div className="online-mode-choice" role="group" aria-label="Tipo de batalla en línea">
        <button
          type="button"
          className="online-mode-card flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-solid p-5 text-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:p-7"
          data-online-mode="public"
          onClick={commands.startOnlineSearch}
        >
          <span className="online-mode-symbol mb-1 flex shrink-0 items-center justify-center">
            <MenuIcon kind="match-search" />
          </span>
          <strong className="font-heading text-xl font-semibold text-ink">Buscar partida</strong>
          <small className="max-w-64 text-sm leading-relaxed text-muted">
            {account.user
              ? 'Encuentra un rival y empieza a jugar.'
              : 'Inicia sesión para buscar rival y competir por Elo.'}
          </small>
        </button>
        <button
          type="button"
          className="online-mode-card flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-solid p-5 text-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:p-7"
          data-online-mode="private"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'private' })}
        >
          <span className="online-mode-symbol mb-1 flex shrink-0 items-center justify-center">
            <MenuIcon kind="private-room" />
          </span>
          <strong className="font-heading text-xl font-semibold text-ink">Partida privada</strong>
          <small className="max-w-64 text-sm leading-relaxed text-muted">
            Crea una sala o únete con un código de seis cifras.
          </small>
        </button>
      </div>
      <OnlineAvailability />
      <div className="online-menu-actions flex flex-wrap items-center justify-between gap-3">
        <Button
          size="compact"
          onClick={() =>
            snapshot.homeView ? commands.closeDialog() : commands.openDialog({ kind: 'mode' })
          }
        >
          Volver
        </Button>
        {snapshot.online.available && (
          <Button
            variant="ghost"
            size="compact"
            aria-label="Recuperar partida en línea"
            onClick={commands.resumeOnline}
            disabled={snapshot.online.busy}
          >
            <span className="online-recover-icon flex size-4" aria-hidden="true">
              <MenuIcon kind="history" />
            </span>
            Recuperar partida
          </Button>
        )}
      </div>
    </>
  );
}

export function OnlineSearchDialog() {
  return (
    <>
      <DialogClose label="Cerrar búsqueda de partida" className="dialog-corner-close" />
      <span className="eyebrow">BATALLA EN LÍNEA</span>
      <h2>Buscar partida</h2>
      <OnlineWaiting publicSearch />
    </>
  );
}
