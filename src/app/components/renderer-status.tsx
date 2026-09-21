import { useEffect, useState, type RefObject } from 'react';

/** Keep initialization failures readable even when no graphics context is available. */
export function RendererStatus({
  canvasRef,
  overlay = false,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  overlay?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onError = () => setFailed(true);
    const onReady = () => setFailed(false);
    canvas.addEventListener('renderererror', onError);
    canvas.addEventListener('rendererready', onReady);
    return () => {
      canvas.removeEventListener('renderererror', onError);
      canvas.removeEventListener('rendererready', onReady);
    };
  }, [canvasRef]);
  if (!failed) return null;
  return (
    <p
      role="alert"
      className={`${overlay ? 'absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 ' : ''}rounded-lg border border-amber/50 bg-panel p-4 text-center text-sm text-ink`}
    >
      No se ha podido mostrar el tablero. Vuelve a cargar la página o prueba con otro navegador.
    </p>
  );
}
