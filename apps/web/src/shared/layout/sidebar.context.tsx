import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Trạng thái thu gọn sidebar — nâng từ `useState` cục bộ trong `Sidebar.tsx` lên context dùng
 * chung (cùng khuôn `breadcrumb.context.tsx`) để trang con (ví dụ màn hình khám, S3-06) có thể chủ
 * động yêu cầu thu gọn qua `useAutoCollapseSidebar()` — `Sidebar.tsx` và nội dung route là 2 nhánh
 * anh em dưới `AppShell`, không có quan hệ cha/con nên không truyền prop trực tiếp được.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return <SidebarContext.Provider value={{ collapsed, setCollapsed }}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar() phải gọi bên trong SidebarProvider.');
  return ctx;
}

/**
 * Gọi trong trang cần không gian làm việc rộng (màn hình khám, nhiều panel/cột) — tự thu gọn
 * sidebar lúc vào trang, tự khôi phục lại trạng thái trước đó lúc rời trang (không ép người dùng
 * luôn thấy sidebar thu gọn ở mọi trang khác sau khi rời màn hình khám).
 */
export function useAutoCollapseSidebar(): void {
  const { collapsed, setCollapsed } = useSidebar();
  const previousRef = useRef(collapsed);

  useEffect(() => {
    previousRef.current = collapsed;
    setCollapsed(true);
    return () => setCollapsed(previousRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy lúc mount/unmount, không theo dõi `collapsed` đổi sau đó (người dùng có thể tự mở lại tay trong lúc khám).
  }, []);
}

/**
 * "Tự động thu gọn menu khi chuyển trang" (2026-09-07, tenant_setting `sidebarAutoCollapseEnabled`,
 * mặc định TẮT — `docs/DECISIONS.md`) — KHÔNG liên quan tới `useAutoCollapseSidebar()` ở trên (màn
 * hình khám luôn tự thu gọn CỐ ĐỊNH, không đi qua cờ này — đã hỏi và chốt qua `AskUserQuestion`).
 * Gọi Ở CẤP `Sidebar.tsx` (không phải trang con) vì cần biết MỌI lần đổi route trong toàn app, kể
 * cả điều hướng không qua sidebar (breadcrumb, nút "Quay lại", điều hướng lập trình sau khi lưu...).
 * Ép thu gọn lại mỗi lần đổi `pathname` (không tự khôi phục trạng thái mở tay của người dùng ở lần
 * điều hướng kế tiếp — quyết định đã chốt, khác hẳn `useAutoCollapseSidebar()`).
 */
export function useAutoCollapseSidebarOnNavigate(enabled: boolean): void {
  const { setCollapsed } = useSidebar();
  const { pathname } = useLocation();

  useEffect(() => {
    if (enabled) setCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ ép thu gọn khi ĐỔI trang hoặc đổi cấu hình, không phải mỗi lần `setCollapsed` đổi (người dùng có thể tự mở lại tay trong lúc đứng yên ở trang hiện tại).
  }, [pathname, enabled]);
}