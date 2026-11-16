/**
 * Browser counterpart of `electron/pdfText.cjs`: raw text per page from PDF
 * bytes, via pdfjs-dist (loaded lazily, same worker setup as `PdfView`).
 * Cleaning and budgeting happen in `src/quiz/pdfContext.ts`, as on desktop.
 */

export const MAX_PDF_PAGES = 500;

export async function extractPdfPagesInBrowser(
  bytes: Uint8Array,
  maxPages = MAX_PDF_PAGES,
): Promise<{ pages: string[]; totalPages: number }> {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist');
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  // pdf.js may transfer the buffer to its worker, so hand it a copy.
  const task = getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const pageCount = Math.min(pdf.numPages, maxPages);
    const pages: string[] = [];
    for (let i = 1; i <= pageCount; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join(''),
      );
    }
    return { pages, totalPages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
