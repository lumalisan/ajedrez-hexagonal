import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignSystemPreview } from './preview';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el contenedor del catálogo.');
createRoot(root).render(
  <StrictMode>
    <DesignSystemPreview />
  </StrictMode>,
);
