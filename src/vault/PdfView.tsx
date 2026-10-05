import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { noteTitle } from './fileTree';
import { VaultService } from './VaultService';

/** Minimal in-app PDF reader with centered pages and one continuous scroll area. */
export function PdfView({ path, vaultRoot }: { path: string; vaultRoot: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const textLayerRefs = useRef(new Map<number, HTMLDivElement>());
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let loading: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null;
    setPdf(null);
    setPageCount(0);
    setError('');
    setZoom(1);
    if (!vaultRoot) {
      setError('Open a vault to read this PDF.');
      return;
    }
    void VaultService.readPdf(vaultRoot, path).then((data) => import('pdfjs-dist').then(({ GlobalWorkerOptions, getDocument }) => {
      if (disposed) return;
      GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      loading = getDocument({ data });
      return loading.promise.then((document) => {
        if (disposed) {
          void loading?.destroy();
          return;
        }
        setPdf(document);
        setPageCount(document.numPages);
      });
    })).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not open this PDF.');
    });
    return () => {
      disposed = true;
      void loading?.destroy();
    };
  }, [path, vaultRoot]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !pageCount || !containerWidth) return;
    let disposed = false;
    const tasks: RenderTask[] = [];
    const textLayers: Array<{ cancel: () => void }> = [];
    const render = async () => {
      try {
        const { TextLayer } = await import('pdfjs-dist');
        for (let number = 1; number <= pageCount; number += 1) {
          const canvas = canvasRefs.current.get(number);
          const textContainer = textLayerRefs.current.get(number);
          if (!canvas || !textContainer || disposed) return;
          textContainer.replaceChildren();
          const page = await pdf.getPage(number);
          if (disposed) return;
          const base = page.getViewport({ scale: 1 });
          const scale = Math.max(0.3, (containerWidth - 64) / base.width) * zoom;
          const viewport = page.getViewport({ scale });
          textContainer.style.setProperty('--total-scale-factor', String(scale));
          textContainer.style.setProperty('--scale-factor', String(scale));
          const outputScale = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const context = canvas.getContext('2d');
          if (!context) continue;
          const task = page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          tasks.push(task);
          await task.promise;
          if (disposed) return;
          const textLayer = new TextLayer({
            textContentSource: await page.getTextContent(),
            container: textContainer,
            viewport,
          });
          textLayers.push(textLayer);
          await textLayer.render();
        }
      } catch (cause) {
        if (!disposed && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) {
          setError(cause instanceof Error ? cause.message : 'Could not render this PDF.');
        }
      }
    };
    void render();
    return () => {
      disposed = true;
      tasks.forEach((task) => task.cancel());
      textLayers.forEach((layer) => layer.cancel());
    };
  }, [pdf, pageCount, containerWidth, zoom]);

  return (
    <section className="pdf-reader" aria-label={`PDF: ${noteTitle(path)}`}>
      <header className="pdf-toolbar">
        <span className="pdf-title" title={noteTitle(path)}>{noteTitle(path)}</span>
        <div className="pdf-controls">
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom((value) => Math.max(0.6, Math.round((value - 0.1) * 10) / 10))}>−</button>
          <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 1.8} onClick={() => setZoom((value) => Math.min(1.8, Math.round((value + 0.1) * 10) / 10))}>+</button>
          <span className="pdf-page-count">{pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}</span>
        </div>
      </header>
      <div className="pdf-scroll" ref={scrollRef}>
        {error ? <div className="pdf-message" role="alert">Unable to display this PDF: {error}</div> : null}
        {!pdf && !error ? <div className="pdf-message">Loading PDF…</div> : null}
        {pdf ? Array.from({ length: pageCount }, (_, index) => {
          const page = index + 1;
          return (
            <div className="pdf-page" key={`${path}-${page}`}>
              <canvas ref={(element) => {
                if (element) canvasRefs.current.set(page, element);
                else canvasRefs.current.delete(page);
              }} aria-label={`Page ${page}`} />
              <div className="pdf-text-layer" ref={(element) => {
                if (element) textLayerRefs.current.set(page, element);
                else textLayerRefs.current.delete(page);
              }} aria-label={`Selectable text on page ${page}`} />
            </div>
          );
        }) : null}
      </div>
    </section>
  );
}
