import { Suspense, lazy } from 'react';

const AppShell = lazy(() => import('./app/AppShell.jsx'));

export default function App() {
  return (
    <Suspense fallback={<div className="app-boot">Loading Myanmar Grid…</div>}>
      <AppShell />
    </Suspense>
  );
}
