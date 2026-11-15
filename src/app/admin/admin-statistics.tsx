import { useEffect, useId, useRef, useState } from 'react';
import { ADMIN_PERIODS, type AdminPeriod, type AdminTraffic } from '../../admin-contracts';
import { GameSelect } from '../components/game-select';
import { AdminDataState } from './admin-data-view';
import { adminDate, adminNumber, useAdminData, type AuthFailure } from './admin-data';

const labels = ['Últimas 24 horas', ...[7, 14, 30, 90, 365].map((days) => `Últimos ${days} días`)];
const periods = ADMIN_PERIODS.map((value, index) => ({ value, label: labels[index] }));
const shortDate = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Madrid',
});
const shortTime = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
});
const signedPercent = new Intl.NumberFormat('es-ES', {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
});

export function AdminStatistics({ onAuthFailure }: { onAuthFailure: AuthFailure }) {
  const [period, setPeriod] = useState<AdminPeriod>('30d');
  const { data, error, reload } = useAdminData<AdminTraffic>(
    'view=traffic&period=' + period,
    onAuthFailure,
  );
  return (
    <>
      <div className="admin-range">
        <div>
          <label htmlFor="admin-period">Período</label>
          <GameSelect
            inputId="admin-period"
            options={periods}
            value={period}
            onChange={setPeriod}
          />
        </div>
        {data && (
          <div className="admin-range-dates">
            <strong>{adminDate.formatRange(new Date(data.start), new Date(data.end))}</strong>
            <span>
              Período anterior ·{' '}
              {adminDate.formatRange(new Date(data.previousStart), new Date(data.start))}
            </span>
          </div>
        )}
      </div>
      {data ? (
        <TrafficReport data={data} hourly={period === '24h'} />
      ) : (
        <AdminDataState error={error} reload={reload} />
      )}
    </>
  );
}

function TrafficReport({ data, hourly }: { data: AdminTraffic; hourly: boolean }) {
  const firstObserved = data.firstObservedAt ? new Date(data.firstObservedAt) : null;
  const comparable = Boolean(firstObserved && firstObserved <= new Date(data.previousStart));
  return (
    <>
      <dl className="admin-metrics">
        <Metric
          label="Sesiones del sitio"
          value={data.sessions}
          previous={data.previousSessions}
          comparable={comparable}
        />
        <Metric
          label="Visitantes únicos"
          value={data.visitors}
          previous={data.previousVisitors}
          comparable={comparable}
        />
      </dl>
      {!comparable && (
        <p className="admin-coverage">
          {firstObserved
            ? `Primer registro el ${adminDate.format(firstObserved)}. La comparación porcentual estará disponible cuando haya datos para ambos períodos completos.`
            : 'Todavía no se han registrado visitas.'}
        </p>
      )}
      <TrafficChart buckets={data.buckets} hourly={hourly} />
      <p className="admin-footnote">
        Se cuentan las visitas de quienes aceptaron la medición. Un visitante único corresponde a un
        navegador. Una nueva sesión empieza tras 30 minutos sin actividad. Horario de Madrid.
      </p>
    </>
  );
}

function Metric({
  label,
  value,
  previous,
  comparable,
}: {
  label: string;
  value: number;
  previous: number;
  comparable: boolean;
}) {
  const difference = previous ? (value - previous) / previous : null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{adminNumber.format(value)}</strong>
        {comparable && (
          <span data-change={difference === null ? undefined : Math.sign(difference)}>
            {difference === null && value > 0
              ? 'Sin base porcentual'
              : signedPercent.format(difference ?? 0)}
          </span>
        )}
      </dd>
      <dd className="admin-previous">{adminNumber.format(previous)} en el período anterior</dd>
    </div>
  );
}

function TrafficChart({ buckets, hourly }: { buckets: AdminTraffic['buckets']; hourly: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const title = useId();
  const [point, setPoint] = useState<number>();
  const interval = Math.max(1, Math.ceil(Math.max(...buckets.map(({ sessions }) => sessions)) / 4));
  const top = 4 * interval;
  const formatter = hourly ? shortTime : shortDate;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || !buckets.length) return;
    function draw() {
      if (!element || !context) return;
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const scale = window.devicePixelRatio;
      element.width = Math.round(width * scale);
      element.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const styles = getComputedStyle(element);
      const color = styles.getPropertyValue('--blue').trim();
      const x = (i: number) => 2 + ((width - 4) * i) / (buckets.length - 1);
      const y = (n: number) => 2 + (height - 4) * (1 - n / top);
      context.beginPath();
      buckets.forEach(({ sessions }, i) => {
        if (i === 0) context.moveTo(x(i), y(sessions));
        else context.lineTo(x(i), y(sessions));
      });
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.stroke();
      context.lineTo(width - 2, height);
      context.lineTo(2, height);
      context.closePath();
      context.globalAlpha = 0.17;
      context.fillStyle = color;
      context.fill();
    }
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, [buckets, top]);
  const selected = point === undefined ? undefined : buckets[point];
  return (
    <section className="admin-chart" aria-labelledby={title}>
      <h2 id={title}>Sesiones a lo largo del tiempo</h2>
      <div className="admin-plot" aria-hidden="true">
        <div className="admin-y-axis">
          {[4, 3, 2, 1, 0].map((i) => (
            <span key={i}>{adminNumber.format(i * interval)}</span>
          ))}
        </div>
        <div
          className="admin-plot-area"
          onPointerMove={(event) => {
            const { left, width } = event.currentTarget.getBoundingClientRect();
            setPoint(Math.round(((event.clientX - left) / width) * (buckets.length - 1)));
          }}
          onPointerLeave={() => setPoint(undefined)}
        >
          <div className="admin-chart-grid">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <canvas ref={canvas} />
          {selected && (
            <div className="admin-chart-tooltip">
              {formatter.format(new Date(selected.start))} · {adminNumber.format(selected.sessions)}{' '}
              sesiones
            </div>
          )}
        </div>
        <div className="admin-x-axis">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const bucket = buckets[Math.round(fraction * (buckets.length - 1))];
            return <span key={fraction}>{formatter.format(new Date(bucket.start))}</span>;
          })}
        </div>
      </div>
      <details className="admin-chart-data">
        <summary>Ver datos del gráfico</summary>
        <div
          className="admin-table-scroll"
          role="region"
          aria-label="Datos del gráfico"
          tabIndex={0}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Intervalo</th>
                <th scope="col">Sesiones</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(({ start, end, sessions }) => (
                <tr key={start}>
                  <th scope="row">{adminDate.formatRange(new Date(start), new Date(end))}</th>
                  <td>{adminNumber.format(sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
