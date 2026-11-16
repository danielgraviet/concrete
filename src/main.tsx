import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import App from './App';
import { PdfExportPage } from './export/PdfExportPage';
import { AppTheme } from './AppTheme';
import { installSystemClipboardSync } from './systemClipboardSync';
import './styles.css';

installSystemClipboardSync();

const exportingPdf = new URLSearchParams(window.location.search).get('export') === 'pdf';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.VITE_TARGET === 'web' && !exportingPdf) {
  // Web: sign-in + cloud vault (Firebase is loaded lazily, only when configured).
  void import('./web/startWeb').then(({ startWeb }) => startWeb(root, App));
} else {
  root.render(
    exportingPdf ? (
      <PdfExportPage />
    ) : (
      <StrictMode>
        <AppTheme>
          <App />
        </AppTheme>
      </StrictMode>
    ),
  );
}
