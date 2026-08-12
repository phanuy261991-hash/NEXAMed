import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { AppBootstrap } from './AppBootstrap';
import { AppConfigProvider } from './AppConfigProvider';
import type { AppConfig } from './config';
import { router } from './router';

/**
 * Không retry khi server đã trả lời rõ ràng "không tồn tại" (404, NOT_FOUND) — mặc định
 * TanStack Query retry 3 lần có backoff cho mọi lỗi kể cả lỗi này, làm chậm hiển thị empty state
 * vài giây không cần thiết (phát hiện thật lúc kiểm bằng trình duyệt ở S2-08, PatientDetailPage
 * với id không tồn tại). Lỗi khác (mất mạng, 5xx) vẫn retry tối đa 3 lần như mặc định.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') return false;
        return failureCount < 3;
      },
    },
  },
});

export function App({ config }: { config: AppConfig }) {
  return (
    <AppConfigProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AppBootstrap />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppConfigProvider>
  );
}
