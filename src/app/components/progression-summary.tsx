import { levelProgress } from '../../progression';
import { useGame } from '../game-context';

export function ProgressionSummary() {
  const { snapshot } = useGame();
  const progress = levelProgress(snapshot.progression.xp);
  return (
    <div className="progression-summary">
      <div>
        <strong>Nivel {progress.level}</strong>
        <span>{progress.category}</span>
      </div>
      <span>{snapshot.progression.xp.toLocaleString('es-ES')} XP acumulados</span>
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
      <small>
        Racha de actividad: {snapshot.progression.activity.streak} días · Mejor:{' '}
        {snapshot.progression.activity.best}
      </small>
    </div>
  );
}
