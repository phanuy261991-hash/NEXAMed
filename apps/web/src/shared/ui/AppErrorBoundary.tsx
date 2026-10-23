import { Component } from 'react';
import type { ReactNode } from 'react';
import { classifyAppError, logAppError } from '../errors/app-error';
import { AppErrorScreen } from './AppErrorScreen';

interface State {
  hasError: boolean;
  error: unknown;
}

/**
 * Lớp bắt lỗi gốc của ứng dụng (docs/DECISIONS.md #255): ngoại lệ nào không được lớp trong xử lý — kể cả ở các provider bọc ngoài router — đều
 * dẫn tới `AppErrorScreen` toàn trang thay vì trang trắng. Lỗi bên trong một trang do `errorElement` của router (`RouteErrorScreen`) bắt trước,
 * giữ nguyên khung ứng dụng; lớp này là lưới đỡ cuối cùng.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown): void {
    logAppError(error);
  }

  override render(): ReactNode {
    if (this.state.hasError) return <AppErrorScreen kind={classifyAppError(this.state.error)} />;
    return this.props.children;
  }
}
