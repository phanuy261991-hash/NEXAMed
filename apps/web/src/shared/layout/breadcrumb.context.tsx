import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface BreadcrumbItem {
  label: string;
  /** Bỏ trống = đoạn hiện tại, không phải link (đoạn cuối luôn không link). */
  to?: string;
}

interface BreadcrumbContextValue {
  items: BreadcrumbItem[];
  setItems: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/**
 * Nguồn breadcrumb dùng chung cho `TopBar` (.claude/docs/ui-guidelines.md mục 8.2) — thay thế
 * nút "← Quay lại" trên từng trang con. Đặt ở `shared/layout` vì mọi trang (bệnh nhân, lịch hẹn,
 * tiếp nhận... sau này) đều cần khai báo breadcrumb của chính nó.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);
  const value = useMemo(() => ({ items, setItems }), [items]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Gọi trong component trang để khai báo breadcrumb của chính nó — hỗ trợ cả đoạn tĩnh (menu cha)
 * lẫn đoạn động (ví dụ tên bệnh nhân sau khi tải xong). Không dọn về rỗng lúc unmount: trang kế
 * tiếp luôn tự khai báo breadcrumb của nó ngay khi mount, dọn về rỗng chỉ tạo một khung nhìn trống
 * chớp nhoáng giữa hai trang.
 */
export function useBreadcrumb(items: BreadcrumbItem[]): void {
  const ctx = useContext(BreadcrumbContext);
  const key = items.map((item) => `${item.label}|${item.to ?? ''}`).join('>');
  // Chỉ chạy lại khi nội dung breadcrumb thực sự đổi (`key`) — không phải mỗi khi `ctx` đổi tham
  // chiếu (Provider tạo lại value mỗi lần `items` đổi), tránh vòng lặp set-lại-chính-nó.
  useEffect(() => {
    ctx?.setItems(items);
  }, [key]);
}

export function useBreadcrumbItems(): BreadcrumbItem[] {
  const ctx = useContext(BreadcrumbContext);
  return ctx?.items ?? [];
}
