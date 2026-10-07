import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import wordmarkUrl from '../../docs/design/cinderblock-concrete-text-belwo.svg?url';
import { ensureKatexCss } from '../editor/math/ensureKatexCss';
import { noteExportTitle, prepareNoteMarkdown } from './prepareNoteMarkdown';
import './pdfExport.css';

type ExportJob = {
  root: string;
  notePath: string;
  markdown: string;
  title: string;
};

async function inlineLocalImages(job: ExportJob): Promise<string> {
  const readImage = window.vault?.readImageDataUrl;
  if (!readImage) return job.markdown;
  let markdown = job.markdown;
  const images = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
  for (const match of images) {
    const src = match[2];
    if (/^(https?:|data:)/i.test(src)) continue;
    try {
      const dataUrl = await readImage(job.root, job.notePath, src);
      if (dataUrl) markdown = markdown.replace(match[0], `![${match[1]}](${dataUrl})`);
    } catch {
      markdown = markdown.replace(match[0], match[1] || '');
    }
  }
  return markdown;
}

/** Hidden window body. Electron prints this document to a PDF beside the note. */
export function PdfExportPage() {
  const [job, setJob] = useState<ExportJob | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('pdf-exporting');
    let cancel = false;
    void (async () => {
      const pending = await window.vault?.takePdfExport?.();
      if (!pending || cancel) {
        window.vault?.pdfExportReady?.();
        return;
      }
      const markdown = prepareNoteMarkdown(await inlineLocalImages({
        ...pending,
        markdown: pending.markdown,
        title: pending.title || noteExportTitle(pending.markdown, pending.notePath),
      }));
      if (cancel) return;
      setJob({
        root: pending.root,
        notePath: pending.notePath,
        markdown,
        title: pending.title || noteExportTitle(pending.markdown, pending.notePath),
      });
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!job) return;
    document.title = job.title;
    let cancel = false;
    void (async () => {
      try {
        await ensureKatexCss();
        if (document.fonts?.ready) await document.fonts.ready;
        await Promise.all(
          [...document.images].map(
            (img) =>
              img.complete
                ? undefined
                : new Promise<void>((resolve) => {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                  }),
          ),
        );
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      } finally {
        if (!cancel) window.vault?.pdfExportReady?.();
      }
    })();
    return () => {
      cancel = true;
    };
  }, [job]);

  if (!job) return null;

  return (
    <article className="pdf-export">
      <img className="pdf-export-wordmark" src={wordmarkUrl} alt="Concrete" />
      <div className="pdf-export-body">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {job.markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}
