import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/app-router';
import './styles.css';

const admin = window.location.pathname.replace(/\/$/, '') === '/admin';
const root = document.getElementById('root');
if (!root) throw new Error('Falta el contenedor de la aplicación.');

createRoot(root).render(
  <StrictMode>
    <AppRouter admin={admin} />
  </StrictMode>,
);

if (!admin && 'serviceWorker' in navigator && import.meta.env.PROD) {
  const register = (): void => {
    void navigator.serviceWorker.register('/sw.js');
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
