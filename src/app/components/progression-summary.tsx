import { levelProgress, type PlayerProgression } from '../../progression';
import { useGame } from '../game-context';

export function ProgressionSummary({
  showActivity = true,
  progression,
}: {
  showActivity?: boolean;
  progression?: Pick<PlayerProgression, 'xp' | 'activity'>;
}) {
  const { snapshot } = useGame();
  const data = progression ?? snapshot.progression;
  const progress = levelProgress(data.xp);
  return (
    <div className="progression-summary">
      <div>
        <strong>
          Nivel {progress.level} – {progress.category}
        </strong>
      </div>
      <span>{data.xp.toLocaleString('es-ES')} XP acumulados</span>
      {progress.required ? (
        <>
          <progress
            value={progress.current}
            max={progress.required}
            aria-label="Experiencia para el siguiente nivel"
          />
          <small>
            {progress.current} / {progress.required} XP para el nivel {progress.level + 1}
          </small>
        </>
      ) : (
        <small>Nivel máximo alcanzado</small>
      )}
      {showActivity && (
        <small>
          Racha de actividad: {data.activity.streak} días · Mejor: {data.activity.best}
        </small>
      )}
    </div>
  );
}
