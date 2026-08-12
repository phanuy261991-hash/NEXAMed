import type { ReactNode } from 'react';
import { BreadcrumbProvider } from './breadcrumb.context';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Bố cục chính sau đăng nhập — App Shell v2 (.claude/docs/ui-guidelines.md mục 8,
 * docs/DECISIONS.md #027): Sidebar tự quản lý container/độ rộng của chính nó (kể cả thu gọn) +
 * cột phải gồm TopBar (breadcrumb + lời chào/avatar, thay user-card cũ ở chân sidebar) và vùng
 * nội dung.
 *
 * `h-dvh` (cố định đúng chiều cao viewport, không phải `min-h-dvh`) là điều kiện bắt buộc để các
 * màn hình danh sách (List Screen Pattern, mục 9) tự quản lý cuộn nội bộ đúng cách — nội dung
 * `h-full` bên trong `<main>` sẽ không bao giờ vượt quá `<main>` nên vùng cuộn ngoài
 * (`overflow-y-auto` ở đây) không kích hoạt cho riêng các màn hình đó, chỉ dùng cho màn hình
 * thường (form/empty-state) khi nội dung cao hơn viewport.
 *
 * Không còn `max-w`/`padding` mặc định ở đây — mỗi trang tự quyết định độ rộng và khoảng đệm của
 * chính nó (danh sách rộng gần hết chiều ngang; form/trang thường tự thêm `max-w` + `p-8`), tránh
 * một khung chung ép mọi loại màn hình vào cùng một bố cục.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <BreadcrumbProvider>
      <div className="flex h-dvh bg-slate-50">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
