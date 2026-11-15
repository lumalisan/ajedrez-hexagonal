import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AdminMatch,
  AdminPage,
  AdminReplay,
  AdminUser,
  AdminUserSort,
} from '../../admin-contracts';
import { outcomeText } from '../../engine';
import type { PublicPlayerProfile } from '../../ranking-contracts';
import { ProfileView } from '../dialogs/profile-dialog';
import { Button } from '../components/ui/button';
import { adminRequest } from './admin-client';
import { AdminDataState, AdminEmpty, AdminPagination } from './admin-data-view';
import { adminDate, adminNumber, useAdminData, type AuthFailure } from './admin-data';

const ReplayBoard = lazy(() =>
  import('./admin-replay').then(({ AdminReplayBoard }) => ({ default: AdminReplayBoard })),
);
const columns: { key: AdminUserSort; label: string; number?: boolean }[] = [
  { key: 'registeredAt', label: 'Fecha de registro' },
  { key: 'name', label: 'Nombre de usuario' },
  { key: 'email', label: 'Correo electrónico' },
  { key: 'matches', label: 'Partidas jugadas', number: true },
  { key: 'recentVisits', label: 'Visitas últimos 30 días', number: true },
  { key: 'totalVisits', label: 'Visitas totales', number: true },
];
const matchModes = { online: 'En línea', machine: 'Vs. Hexfortia', local: 'Local' };

function AdminDialog({
  title,
  close,
  children,
  className,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`admin-dialog ${className ?? ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}

export function AdminUsers({
  onAuthFailure,
  accountId,
  onAccountDeleted,
}: {
  onAuthFailure: AuthFailure;
  accountId: string;
  onAccountDeleted: () => void;
}) {
  const [sort, setSort] = useState<{ key: AdminUserSort; direction: 'asc' | 'desc' }>({
    key: 'registeredAt',
    direction: 'desc',
  });
  const [page, setPage] = useState(0);
  const [user, setUser] = useState<AdminUser>();
  const [deleted, setDeleted] = useState('');
  const { data, error, reload } = useAdminData<AdminPage<AdminUser>>(
    `view=users&page=${page}&sort=${sort.key}&direction=${sort.direction}`,
    onAuthFailure,
  );

  return (
    <>
      {deleted && (
        <p className="admin-success" role="status">
          Se ha eliminado la cuenta de {deleted}.
        </p>
      )}
      <div
        className="admin-table-scroll"
        role="region"
        aria-label="Usuarios registrados"
        tabIndex={0}
      >
        <table className="admin-table admin-users">
          <thead>
            <tr>
              {columns.map(({ key, label, number }) => (
                <th
                  key={key}
                  scope="col"
                  data-numeric={number}
                  aria-sort={
                    sort.key === key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort({
                        key,
                        direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
                      });
                      setPage(0);
                    }}
                  >
                    {label}
                    <span aria-hidden="true">
                      {sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((row) => (
              <tr key={row.id}>
                <td>
                  <time dateTime={row.registeredAt}>
                    {adminDate.format(new Date(row.registeredAt))}
                  </time>
                </td>
                <td>
                  <button type="button" className="admin-user-link" onClick={() => setUser(row)}>
                    {row.name}
                  </button>
                </td>
                <td>{row.email || '—'}</td>
                <td data-numeric>{adminNumber.format(row.matches)}</td>
                <td data-numeric>{adminNumber.format(row.recentVisits)}</td>
                <td data-numeric>{adminNumber.format(row.totalVisits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data && <AdminDataState error={error} reload={reload} />}
      {data && !data.entries.length && <AdminEmpty>No hay usuarios en esta página.</AdminEmpty>}
      <AdminPagination page={page} hasMore={Boolean(data?.hasMore)} onPage={setPage} />
      {user && (
        <UserProfile
          user={user}
          close={() => setUser(undefined)}
          onAuthFailure={onAuthFailure}
          onDeleted={() => {
            if (user.id === accountId) {
              onAccountDeleted();
              return;
            }
            setDeleted(user.name);
            setUser(undefined);
            if (page > 0 && data?.entries.length === 1) setPage(page - 1);
            else reload();
          }}
        />
      )}
    </>
  );
}

function UserProfile({
  user,
  close,
  onAuthFailure,
  onDeleted,
}: {
  user: AdminUser;
  close: () => void;
  onAuthFailure: AuthFailure;
  onDeleted: () => void;
}) {
  const { data, error, reload } = useAdminData<PublicPlayerProfile>(
    'view=profile&id=' + encodeURIComponent(user.id),
    onAuthFailure,
  );
  return (
    <AdminDialog title={'Perfil de ' + user.name} close={close} className="admin-profile-dialog">
      {data ? (
        <ProfileView
          data={data}
          onClose={close}
          autoFocusClose
          actions={
            <DeleteAccount user={user} onAuthFailure={onAuthFailure} onDeleted={onDeleted} />
          }
        />
      ) : (
        <div className="admin-dialog-body">
          <div className="admin-dialog-heading">
            <h2>{user.name}</h2>
            <Button onClick={close}>Cerrar</Button>
          </div>
          <AdminDataState error={error} reload={reload} />
          {error && (
            <DeleteAccount user={user} onAuthFailure={onAuthFailure} onDeleted={onDeleted} />
          )}
        </div>
      )}
    </AdminDialog>
  );
}

function DeleteAccount({
  user,
  onAuthFailure,
  onDeleted,
}: {
  user: AdminUser;
  onAuthFailure: AuthFailure;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setDeleting(true);
    setError(undefined);
    try {
      await adminRequest({ id: user.id }, undefined, 'DELETE');
      onDeleted();
    } catch (cause) {
      onAuthFailure(cause);
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar la cuenta.');
      setDeleting(false);
    }
  }
  return (
    <div className="admin-delete">
      {confirm ? (
        <>
          <p>
            <strong>Eliminar la cuenta de {user.name}</strong>
          </p>
          <p>
            Se eliminarán el acceso, el progreso y sus guardados en la nube. Si hay una partida en
            curso, se cerrará por abandono. Esta acción es definitiva.
          </p>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <div>
            <Button
              disabled={deleting}
              onClick={() => {
                setConfirm(false);
                setError(undefined);
              }}
            >
              Cancelar
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Eliminar definitivamente
            </Button>
          </div>
        </>
      ) : (
        <Button variant="ghost" className="admin-delete-trigger" onClick={() => setConfirm(true)}>
          Eliminar cuenta
        </Button>
      )}
    </div>
  );
}

export function AdminHistory({ onAuthFailure }: { onAuthFailure: AuthFailure }) {
  const [page, setPage] = useState(0);
  const [match, setMatch] = useState<AdminMatch>();
  const { data, error, reload } = useAdminData<AdminPage<AdminMatch>>(
    'view=history&page=' + page,
    onAuthFailure,
  );
  return (
    <>
      <p className="admin-description">
        Partidas en línea y partidas locales sincronizadas con una cuenta.
      </p>
      {data ? (
        <>
          {data.entries.length ? (
            <ul className="admin-history">
              {data.entries.map((entry) => (
                <li key={entry.id}>
                  <div className="admin-history-meta">
                    <time dateTime={entry.completedAt}>
                      {adminDate.format(new Date(entry.completedAt))}
                    </time>
                    <span>{matchModes[entry.mode]}</span>
                  </div>
                  <div className="admin-history-detail">
                    <strong>{entry.participants.join(' vs. ')}</strong>
                    <span>
                      {outcomeText(
                        entry.outcome,
                        entry.outcome.type === 'win'
                          ? entry.participants[entry.outcome.winner]
                          : undefined,
                      )}
                      {' · '}
                      {adminNumber.format(entry.plies)} órdenes ·{' '}
                      {formatDuration(entry.durationSeconds)}
                    </span>
                  </div>
                  {entry.replayAvailable ? (
                    <Button
                      onClick={() => setMatch(entry)}
                      aria-label={`Ver repetición de ${entry.participants.join(' contra ')}`}
                      className="admin-history-replay"
                    >
                      Ver repetición
                    </Button>
                  ) : (
                    <span className="admin-muted">Solo resumen</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <AdminEmpty>No hay partidas finalizadas en esta página.</AdminEmpty>
          )}
        </>
      ) : (
        <AdminDataState error={error} reload={reload} />
      )}
      <AdminPagination page={page} hasMore={Boolean(data?.hasMore)} onPage={setPage} />
      {match && (
        <MatchReplay
          match={match}
          close={() => setMatch(undefined)}
          onAuthFailure={onAuthFailure}
        />
      )}
    </>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return minutes ? `${minutes} min ${remaining} s` : `${remaining} s`;
}

function MatchReplay({
  match,
  close,
  onAuthFailure,
}: {
  match: AdminMatch;
  close: () => void;
  onAuthFailure: AuthFailure;
}) {
  const { data, error, reload } = useAdminData<AdminReplay>(
    'view=replay&id=' + encodeURIComponent(match.id),
    onAuthFailure,
  );
  return (
    <AdminDialog title="Repetición de la partida" close={close}>
      <div className="admin-dialog-body">
        <div className="admin-dialog-heading">
          <h2>{match.participants.join(' vs. ')}</h2>
          <Button onClick={close}>Cerrar</Button>
        </div>
        {data ? (
          <Suspense fallback={<p role="status">Preparando el tablero…</p>}>
            <ReplayBoard record={data.record} />
          </Suspense>
        ) : (
          <AdminDataState error={error} reload={reload} />
        )}
      </div>
    </AdminDialog>
  );
}
