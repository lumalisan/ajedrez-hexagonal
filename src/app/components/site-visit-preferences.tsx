import { useEffect, useState } from 'react';
import { canMeasureVisits, clearLocalVisit, trackSiteVisits } from '../../site-visits';
import { useAccount } from '../account-context';
import { Button } from './ui/button';

const KEY = 'hexfortia:visit-preference:v1';
type Choice = 'accepted' | 'declined';

function readChoice(): Choice | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'accepted' || stored === 'declined' ? stored : null;
  } catch {
    return null;
  }
}

export function SiteVisitPreferences() {
  const { account } = useAccount();
  const [enabled, setEnabled] = useState(false);
  const [choice, setChoice] = useState(readChoice);
  const userId = account.user?.id ?? null;
  useEffect(() => {
    if (!canMeasureVisits()) return;
    const controller = new AbortController();
    fetch('/api/visit', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const value: { enabled?: boolean } = await response.json();
        if (!controller.signal.aborted) setEnabled(value.enabled === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (enabled && choice === 'accepted') return trackSiteVisits(userId);
  }, [enabled, choice, userId]);
  if (!enabled) return null;

  function choose(value: Choice) {
    setChoice(value);
    if (value === 'declined') clearLocalVisit();
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // A choice still applies until the current page closes.
    }
  }

  return (
    <details className="rounded-control border border-line bg-panel px-3 text-sm" open={!choice}>
      <summary className="cursor-pointer py-2 text-muted">Medición de visitas</summary>
      <p className="mt-0 mb-2 text-muted">
        Si aceptas, Hexfortia guarda un identificador en este navegador para contar visitas. Cuando
        inicias sesión, las visitas pueden asociarse a tu cuenta. Puedes cambiar tu elección aquí en
        cualquier momento.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          size="compact"
          aria-pressed={choice === 'accepted'}
          onClick={() => choose('accepted')}
        >
          Aceptar
        </Button>
        <Button
          size="compact"
          aria-pressed={choice === 'declined'}
          onClick={() => choose('declined')}
        >
          Rechazar
        </Button>
      </div>
    </details>
  );
}
