import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { CompanyNotFoundPage } from './CompanyNotFoundPage';
import { resolveBootstrap } from './config';
import { configureApiClient } from '../shared/api/client';

// Khu quản trị nền tảng (chỉ tên miền quản trị của hệ thống SaaS) — lazy để bản phòng khám không tải mã của nó.
const PlatformApp = lazy(() => import('../features/platform/PlatformApp').then((m) => ({ default: m.PlatformApp })));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

async function bootstrap(root: HTMLElement) {
  try {
    const result = await resolveBootstrap();

    if (result.kind === 'platform') {
      createRoot(root).render(
        <StrictMode>
          <Suspense fallback={null}>
            <PlatformApp apiBaseUrl={result.apiBaseUrl} />
          </Suspense>
        </StrictMode>,
      );
      return;
    }
    if (result.kind === 'company_not_found') {
      createRoot(root).render(<CompanyNotFoundPage />);
      return;
    }

    configureApiClient(result.config);
    createRoot(root).render(
      <StrictMode>
        <App config={result.config} />
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
