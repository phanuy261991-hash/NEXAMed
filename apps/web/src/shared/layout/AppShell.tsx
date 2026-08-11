import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

/**
 * Bố cục chính sau đăng nhập — sidebar cố định trái (`w-60 bg-slate-900`, docs/design/
 * UI_GUIDELINE.md mục 5) + nội dung chính cuộn riêng, giới hạn `max-w-[1400px]`.
 * `min-h-dvh` thay vì `h-screen` (tránh lỗi viewport trên trình duyệt mobile).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-slate-50">
      <aside className="flex w-60 flex-shrink-0 flex-col bg-slate-900 text-white">
        <Sidebar />
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-8">{children}</div>
      </main>
    </div>
  );
}
