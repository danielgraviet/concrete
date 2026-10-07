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

createRoot(document.getElementById('root')!).render(
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
