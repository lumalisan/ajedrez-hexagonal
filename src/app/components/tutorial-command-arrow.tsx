import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useGame } from '../game-context';
import { placeTutorialArrow } from '../../rendering/tutorial-arrow';

/** The arrow belongs to the scrolling panel, so it follows controls on resize and scroll. */
export function TutorialCommandArrow({ panelRef }: { panelRef: RefObject<HTMLElement | null> }) {
  const { snapshot } = useGame();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;
    if (!panel || !svg || !path) return;
    const update = () => {
      const targets = [
        ...panel.querySelectorAll<HTMLButtonElement>('button[data-tutorial-highlight="true"]'),
      ].filter((button) => !button.disabled && button.getClientRects().length > 0);
      const target =
        targets.find((button) => button.classList.contains('compass-direction')) ??
        targets.find((button) => button.classList.contains('confirm-button')) ??
        targets[0];
      svg.style.visibility = target ? 'visible' : 'hidden';
      if (!target) return;
      const origin = svg.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const center = {
        x: rect.x - origin.x + rect.width / 2,
        y: rect.y - origin.y + rect.height / 2,
      };
      const rectangles = [
        ...panel.querySelectorAll('button, strong, p, h3, .pending-label, .compass-center'),
      ]
        .filter(
          (element) =>
            element !== target && !target.contains(element) && element.getClientRects().length > 0,
        )
        .flatMap((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const boundsList =
            element.tagName === 'BUTTON'
              ? [element.getBoundingClientRect()]
              : [...range.getClientRects()];
          return boundsList.map((bounds) => ({
            x: bounds.x - origin.x,
            y: bounds.y - origin.y,
            width: bounds.width,
            height: bounds.height,
          }));
        });
      const { start, tip } = placeTutorialArrow(
        center,
        Math.max(12, rect.width / 2 - 20) * Math.SQRT2,
        (rect.height / 2 + 6) * Math.SQRT2,
        { width: origin.width, height: origin.height },
        [],
        rectangles,
      );
      const length = Math.hypot(tip.x - start.x, tip.y - start.y);
      const ux = (tip.x - start.x) / length;
      const uy = (tip.y - start.y) / length;
      path.setAttribute(
        'd',
        `M${start.x},${start.y}L${tip.x},${tip.y}M${tip.x - ux * 10 - uy * 5},${tip.y - uy * 10 + ux * 5}L${tip.x},${tip.y}L${tip.x - ux * 10 + uy * 5},${tip.y - uy * 10 - ux * 5}`,
      );
      svg.setAttribute(
        'data-target',
        target.getAttribute('data-command') ?? target.getAttribute('aria-label') ?? 'confirm',
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    if (svg.parentElement) observer.observe(svg.parentElement);
    return () => observer.disconnect();
  }, [
    panelRef,
    snapshot.selectedId,
    snapshot.pendingAction,
    snapshot.mode,
    snapshot.tutorial,
    snapshot.animating,
  ]);
  if (!snapshot.tutorial || snapshot.tutorial.completed || snapshot.animating) return null;
  return (
    <svg ref={svgRef} className="tutorial-command-arrow" aria-hidden="true">
      <path ref={pathRef} />
    </svg>
  );
}
