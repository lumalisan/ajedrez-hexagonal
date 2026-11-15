import { lazy, Suspense } from 'react';

const AdminApp = lazy(() =>
  import('./admin/admin-app').then(({ AdminApp }) => ({ default: AdminApp })),
);
const GameApp = lazy(() => import('./app').then(({ App }) => ({ default: App })));

export function AppRouter({ admin }: { admin: boolean }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          Cargando Hexfortia…
        </p>
      }
    >
      {admin ? <AdminApp /> : <GameApp />}
    </Suspense>
  );
}
