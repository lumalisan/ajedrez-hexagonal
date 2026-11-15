import { browserSupabase } from './supabase-client';

const KEY = 'hexfortia:site-visit:v1';
const INACTIVITY = 30 * 60_000;
interface Visit {
  id: string;
  visitorId: string;
  touchedAt: number;
  userId: string | null;
  sent: boolean;
}

let inMemory: Visit | null = null;

function readVisit(): Visit | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return JSON.parse(stored) as Visit;
  } catch {
    // Keep one visit per page when this browser disables storage.
  }
  return inMemory;
}

function saveVisit(visit: Visit) {
  inMemory = visit;
  try {
    localStorage.setItem(KEY, JSON.stringify(visit));
  } catch {
    // Tracking must never interfere with the game.
  }
}

export function trackSiteVisits(userId: string | null) {
  const controller = new AbortController();
  let sending = false;
  let nextActivity = 0;
  async function touch() {
    if (document.visibilityState !== 'visible' || sending) return;
    const previous = readVisit();
    const now = Date.now();
    const newSession =
      !previous ||
      now - previous.touchedAt >= INACTIVITY ||
      Boolean(previous.userId && userId && previous.userId !== userId);
    const associate = Boolean(userId && !previous?.userId);
    const visit: Visit = {
      id: newSession ? crypto.randomUUID() : previous.id,
      visitorId: previous?.visitorId ?? crypto.randomUUID(),
      touchedAt: now,
      userId: userId ?? (newSession ? null : previous.userId),
      sent: !newSession && !associate && previous.sent,
    };
    saveVisit(visit);
    if (visit.sent) return;
    sending = true;
    try {
      const sdk = userId ? await browserSupabase() : null;
      const session = (await sdk?.auth.getSession())?.data.session;
      if (userId && session?.user.id !== userId) return;
      const response = await fetch('/api/visit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}),
        },
        body: JSON.stringify({ id: visit.id, visitorId: visit.visitorId }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        keepalive: true,
      });
      const latest = readVisit();
      if (
        response.ok &&
        !controller.signal.aborted &&
        latest?.id === visit.id &&
        latest.userId === visit.userId
      )
        saveVisit({ ...latest, sent: true });
    } catch {
      // A later visit, interaction or network recovery retries transient failures.
    } finally {
      sending = false;
    }
  }
  const update = () => void touch();
  function onActivity() {
    const now = Date.now();
    if (now < nextActivity) return;
    nextActivity = now + 60_000;
    update();
  }
  const { signal } = controller;
  document.addEventListener('visibilitychange', update, { signal });
  window.addEventListener('online', update, { signal });
  window.addEventListener('pointerdown', onActivity, { signal, passive: true });
  window.addEventListener('keydown', onActivity, { signal });
  update();
  return () => controller.abort();
}

export function canMeasureVisits() {
  return Boolean(
    import.meta.env.PROD &&
    typeof crypto.randomUUID === 'function' &&
    navigator.doNotTrack !== '1' &&
    !('globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true),
  );
}

export function clearLocalVisit() {
  inMemory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // The browser may disable all access to storage.
  }
}
