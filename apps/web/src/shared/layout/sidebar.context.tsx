import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

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