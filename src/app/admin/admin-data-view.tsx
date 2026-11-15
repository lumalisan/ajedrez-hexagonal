import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';

export function AdminDataState({ error, reload }: { error?: string; reload: () => void }) {
  if (!error)
    return (
      <p className="admin-status" role="status">
        Cargando datos…
      </p>
    );
  return (
    <div className="admin-status">
      <p className="admin-error" role="alert">
        {error}
      </p>
      <Button onClick={reload}>Reintentar</Button>
    </div>
  );
}

export function AdminPagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  if (!page && !hasMore) return null;
  return (
    <nav className="admin-pagination" aria-label="Paginación">
      <Button disabled={page === 0} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span>Página {page + 1}</span>
      <Button disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Siguiente
      </Button>
    </nav>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <p className="admin-status">{children}</p>;
}
