import { noteTitle } from './fileTree';

/** URL served by the `vault-file` protocol in Electron main (open vault, PDFs only). */
export function vaultPdfUrl(path: string): string {
  return `vault-file://local/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Read-only PDF in the editor pane, using Chromium's built-in viewer (zoom, search, pages). */
export function PdfView({ path }: { path: string }) {
  return <iframe key={path} className="pdf-view" title={noteTitle(path)} src={vaultPdfUrl(path)} />;
}
