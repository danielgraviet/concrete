/** Raw text per page from PDF bytes. Shared by Electron main and tests. */
async function extractPdfPages(bytes, maxPages = Infinity) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pageCount = Math.min(pdf.numPages, maxPages);
    const pages = [];
    for (let i = 1; i <= pageCount; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
    }
    return { pages, totalPages: pdf.numPages };
  } finally {
    // unpdf's proxy has no destroy(); the loading task owns the document.
    await pdf.loadingTask.destroy();
  }
}

module.exports = { extractPdfPages };
