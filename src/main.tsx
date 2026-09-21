import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el contenedor de la aplicación.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = (): void => {
    void navigator.serviceWorker.register('/sw.js');
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
