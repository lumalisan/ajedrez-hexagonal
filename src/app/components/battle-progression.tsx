import { useEffect, useState } from 'react';
import {
  levelProgress,
  xpForLevel,
  PROGRESSION_ACHIEVEMENTS,
  type BattleProgression,
} from '../../progression';
import { useGame } from '../game-context';
import { Button } from './ui/button';

/** Animate each level separately, briefly holding a full bar before the next level. */
function useAnimatedXp(before: number, after: number, reduced: boolean) {
  const [frame, setFrame] = useState({ xp: before, fullLevel: null as number | null });
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    let start: number | null = null;
    const segments: { from: number; to: number; level: number; crosses: boolean }[] = [];
    let from = before;
    while (from < after) {
      const level = levelProgress(from).level;
      const to = level < 100 ? Math.min(after, xpForLevel(level + 1)) : after;
      segments.push({ from, to, level, crosses: level < 100 && to === xpForLevel(level + 1) });
      from = to;
    }
    const finish = () => {
      cancelAnimationFrame(request);
      setFrame({ xp: after, fullLevel: null });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finish();
    };
    const onPreference = () => {
      if (media.matches) finish();
    };
    const tick = (now: number) => {
      if (reduced || media.matches || !segments.length) {
        finish();
        return;
      }
      start ??= now;
      const elapsed = now - start;
      const index = Math.floor(elapsed / 1150);
      const segment = segments[index];
      if (!segment) {
        finish();
        return;
      }
      const fraction = Math.min(1, (elapsed % 1150) / 850);
      const xp = Math.floor(segment.from + (segment.to - segment.from) * fraction);
      setFrame({ xp, fullLevel: fraction === 1 && segment.crosses ? segment.level : null });
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    media.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(request);
      media.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [before, after, reduced]);
  return reduced ? { xp: after, fullLevel: null } : frame;
}

export function BattleProgressionPanel({
  battle,
  mode,
}: {
  battle: BattleProgression | undefined;
  mode: 'local' | 'machine' | 'online';
}) {
  const { snapshot, commands } = useGame();
  const before = battle?.xpBefore ?? snapshot.progression.xp;
  const after = battle?.xpAfter ?? snapshot.progression.xp;
  const frame = useAnimatedXp(before, after, snapshot.preferences.reducedMotion);
  const progress = levelProgress(frame.fullLevel === null ? frame.xp : xpForLevel(frame.fullLevel));
  const current = frame.fullLevel === null ? progress.current : progress.required;
  const rewards = battle?.rewards ?? [];
  const earned = rewards.reduce((total, reward) => total + reward.xp, 0);
  const achievements = rewards.flatMap((reward) => {
    const entry = PROGRESSION_ACHIEVEMENTS.find((item) => item.id === reward.achievementId);
    return entry ? [entry] : [];
  });
  const gainedLevels = levelProgress(after).level - levelProgress(before).level;
  const delta = battle ? battle.ratingAfter - battle.ratingBefore : 0;
  return (
    <section
      className="battle-progression"
      aria-label="Progresión de la partida"
      data-xp-animation={frame.xp === after && frame.fullLevel === null ? 'complete' : 'running'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-lg">Tu progreso</h3>
        <strong className="text-accent">+{earned} XP</strong>
      </div>
      <div className="my-3 flex flex-wrap items-baseline justify-between gap-2">
        <strong data-battle-level>
          Nivel {progress.level} · {progress.category}
        </strong>
        <span className="text-sm text-muted">
          {progress.required ? `${current} / ${progress.required} XP` : 'Nivel máximo'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Experiencia del nivel"
        aria-valuemin={0}
        aria-valuemax={progress.required || 1}
        aria-valuenow={progress.required ? current : 1}
        aria-valuetext={`Nivel ${progress.level}, ${current} de ${progress.required} XP`}
        className="battle-xp-track"
      >
        <div
          style={{
            width: `${progress.required ? Math.min(100, (current / progress.required) * 100) : 100}%`,
          }}
        />
      </div>
      <p className="my-2 text-sm text-muted" aria-live="polite">
        {frame.xp === after && frame.fullLevel === null && gainedLevels > 0
          ? `¡Has subido ${gainedLevels === 1 ? 'un nivel' : `${gainedLevels} niveles`}! Nivel ${levelProgress(before).level} → ${levelProgress(after).level}.`
          : `${after.toLocaleString('es-ES')} XP acumulados`}
      </p>
      {rewards.length > 0 ? (
        <ul className="battle-rewards" aria-label="XP obtenida">
          {rewards.map((reward, index) => (
            <li key={`${reward.label}-${index}`}>
              <span>{reward.achievementId ? `Logro: ${reward.label}` : reward.label}</span>
              <strong>+{reward.xp} XP</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {battle
            ? 'No has obtenido XP en esta partida.'
            : 'No hay un desglose de XP disponible para esta partida.'}
        </p>
      )}
      {achievements.length > 0 && (
        <div className="battle-achievements">
          <h4 className="m-0">
            {achievements.length}{' '}
            {achievements.length === 1 ? 'logro desbloqueado' : 'logros desbloqueados'}
          </h4>
          <ul className="m-0 mt-2 list-none p-0">
            {achievements.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.title}</strong>
                <p className="m-0 text-sm text-muted">{entry.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode !== 'local' && (
        <div className="battle-rating">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong>Elo · {mode === 'machine' ? 'Hexfortia' : 'En línea'}</strong>
            <span>
              {battle ? (
                <>
                  {battle.ratingBefore} → <strong>{battle.ratingAfter}</strong> (
                  {delta > 0 ? '+' : ''}
                  {delta})
                </>
              ) : (
                snapshot.progression.ratings[mode]
              )}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted">
              Posición histórica: pendiente de clasificación compartida.
            </span>
            <Button
              variant="ghost"
              size="compact"
              onClick={() => commands.openDialog({ kind: 'ranking' })}
            >
              Ver clasificación
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
