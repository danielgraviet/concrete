import { describe, expect, it } from 'vitest';
import { extractPdfPages } from './pdfText.cjs';

/** Minimal one-page-per-string PDF; pdf.js rebuilds the xref table itself. */
function makePdf(pageTexts: string[]): Uint8Array {
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >> endobj`,
    '3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    ...pageTexts.flatMap((text, i) => {
      const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
      return [
        `${pageIds[i]} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >> endobj`,
        `${pageIds[i] + 1} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
      ];
    }),
  ];
  return new TextEncoder().encode(`%PDF-1.4\n${objects.join('\n')}\ntrailer << /Root 1 0 R >>\n%%EOF`);
}

describe('extractPdfPages', () => {
  it('returns text per page and releases the document', async () => {
    const result = await extractPdfPages(makePdf(['Mitochondria make ATP', 'Ribosomes make proteins']));
    expect(result.totalPages).toBe(2);
    expect(result.pages.map((p: string) => p.trim())).toEqual(['Mitochondria make ATP', 'Ribosomes make proteins']);
  });

  it('stops at maxPages but reports the real page count', async () => {
    const result = await extractPdfPages(makePdf(['one', 'two', 'three']), 2);
    expect(result.pages).toHaveLength(2);
    expect(result.totalPages).toBe(3);
  });
});
