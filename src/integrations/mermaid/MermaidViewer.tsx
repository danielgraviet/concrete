import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** Natural size of a mermaid SVG, from its viewBox (mermaid sets width="100%"). */
function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox.baseVal;
  if (box && box.width && box.height) return { width: box.width, height: box.height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 800, height: rect.height || 600 };
}

/** Full-window pan/zoom viewer for a rendered diagram. */
export function MermaidViewer({ svg, anchor, onClose }: { svg: string; anchor: HTMLElement | null; onClose: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: View } | null>(null);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { width, height } = sizeRef.current;
    const pad = 48;
    const scale = clamp(Math.min((stage.clientWidth - pad) / width, (stage.clientHeight - pad) / height));
    setView({ scale, x: (stage.clientWidth - width * scale) / 2, y: (stage.clientHeight - height * scale) / 2 });
  }, []);

  useLayoutEffect(() => {
    const el = contentRef.current?.querySelector('svg');
    if (el) {
      sizeRef.current = svgSize(el);
      el.removeAttribute('style');
      el.setAttribute('width', String(sizeRef.current.width));
      el.setAttribute('height', String(sizeRef.current.height));
    }
    fit();
  }, [svg, fit]);

  /** Zoom by `factor`, keeping the stage point (px, py) fixed under the cursor. */
  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const cx = px ?? stage.clientWidth / 2;
    const cy = py ?? stage.clientHeight / 2;
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const ratio = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }, []);

  // Wheel needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      // Trackpad pinch arrives as ctrl+wheel with small deltas; scale accordingly.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const actions: Record<string, () => void> = {
      Escape: onClose, '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': fit,
    };
    const onKey = (event: KeyboardEvent) => {
      const action = actions[event.key];
      if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
      // Keep the keystroke from reaching the note editor underneath.
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, zoomAt, fit]);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    setView({ ...d.origin, x: d.origin.x + event.clientX - d.startX, y: d.origin.y + event.clientY - d.startY });
  };
  const endDrag = () => { drag.current = null; };

  // Portal into the themed root so Radix CSS variables still apply.
  const host = anchor?.closest('.radix-themes') ?? document.body;

  return createPortal(
    <div className="mermaid-viewer" role="dialog" aria-modal="true" aria-label="Diagram viewer">
      <div className="mermaid-viewer-toolbar">
        <button type="button" onClick={() => zoomAt(0.8)} title="Zoom out (-)">−</button>
        <span className="mermaid-viewer-zoom">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(1.25)} title="Zoom in (+)">+</button>
        <button type="button" onClick={fit} title="Fit to screen (0)">Fit</button>
        <button type="button" onClick={() => zoomAt(1 / view.scale)} title="Actual size">100%</button>
        <span className="mermaid-viewer-hint">Scroll to zoom · drag to move · Esc to close</span>
        <button type="button" className="mermaid-viewer-close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <div
        ref={stageRef}
        className="mermaid-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          zoomAt(1.6, event.clientX - rect.left, event.clientY - rect.top);
        }}
      >
        <div
          ref={contentRef}
          className="mermaid-viewer-content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    host,
  );
}
