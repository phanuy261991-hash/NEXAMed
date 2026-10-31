import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { useUnsavedChangesStore } from '../shared/hooks/unsaved-changes';
import { classifySystemFailure } from '../shared/errors/system-failure';
import { useSystemFailureStore } from '../shared/errors/system-failure.store';
import { AppErrorBoundary } from '../shared/ui/AppErrorBoundary';
import { SystemFailureDialog } from '../shared/ui/SystemFailureDialog';
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
  // Lỗi HỆ THỐNG khi đang thực hiện một thao tác (mất mạng, máy chủ chưa bật, 5xx) → MỘT hộp thông báo giữ nguyên dữ liệu đang nhập (docs/DECISIONS.md
  // #255). Áp cho MỌI `useMutation` của ứng dụng tại một chỗ; lỗi nghiệp vụ 4xx vẫn hiện tại chỗ như cũ.
  mutationCache: new MutationCache({
    // Một thao tác ghi thành công = dữ liệu nhập đã được lưu: tắt cờ "nhập dở" (cảnh báo rời trang) TRƯỚC khi form điều hướng sang trang khác.
    onSuccess: () => useUnsavedChangesStore.getState().clear(),
    onError: (error) => {
      const kind = classifySystemFailure(error);
      if (kind) useSystemFailureStore.getState().show(kind);
    },
  }),
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
    <AppErrorBoundary>
      <AppConfigProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <AppBootstrap />
          <RouterProvider router={router} />
          <SystemFailureDialog />
        </QueryClientProvider>
      </AppConfigProvider>
    </AppErrorBoundary>
  );
}
