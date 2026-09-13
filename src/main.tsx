import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import 'katex/dist/katex.min.css';
import App from './App';
import { AppTheme } from './AppTheme';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppTheme>
      <App />
    </AppTheme>
  </StrictMode>,
);
