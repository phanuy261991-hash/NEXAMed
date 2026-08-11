import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { loadAppConfig } from './config';
import { configureApiClient } from '../shared/api/client';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

async function bootstrap(root: HTMLElement) {
  try {
    const config = await loadAppConfig();
    configureApiClient(config);

    createRoot(root).render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    );
  } catch (err) {
    createRoot(root).render(
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-8 text-center text-sm text-rose-600">
        {err instanceof Error ? err.message : 'Không khởi động được ứng dụng.'}
      </div>,
    );
  }
}

void bootstrap(rootElement);
