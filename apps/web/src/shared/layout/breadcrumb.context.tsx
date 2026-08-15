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

const APP_NAME = 'NEXAMed';

/**
 * Tiêu đề tab trình duyệt — tái dùng nguyên dữ liệu breadcrumb (docs/DECISIONS.md #047), không
 * khai báo tiêu đề riêng ở từng trang: đoạn ĐẦU (menu cha ở sidebar chính, ví dụ "Tiếp nhận và
 * Đặt lịch") + đoạn CUỐI (trang/tab con đang chọn, ví dụ "Lịch hẹn") — bỏ qua các đoạn ở giữa nếu
 * có (breadcrumb 3+ cấp như trang bệnh nhân/danh mục). Chỉ 1 đoạn (trang không có menu cha, ví dụ
 * "Tổng quan") thì ghép thêm tên ứng dụng làm hậu tố; 0 đoạn (chưa trang nào khai breadcrumb, ví
 * dụ đang ở `/login` ngoài `BreadcrumbProvider`) thì về tên ứng dụng trơn.
 */
function computeDocumentTitle(items: BreadcrumbItem[]): string {
  if (items.length === 0) return APP_NAME;
  if (items.length === 1) return `${items[0]!.label} - ${APP_NAME}`;
  return `${items[0]!.label} - ${items[items.length - 1]!.label}`;
}

/**
 * Nguồn breadcrumb dùng chung cho `TopBar` (.claude/docs/ui-guidelines.md mục 8.2) — thay thế
 * nút "← Quay lại" trên từng trang con. Đặt ở `shared/layout` vì mọi trang (bệnh nhân, lịch hẹn,
 * tiếp nhận... sau này) đều cần khai báo breadcrumb của chính nó.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);
  const value = useMemo(() => ({ items, setItems }), [items]);

  useEffect(() => {
    document.title = computeDocumentTitle(items);
  }, [items]);

  // Rời khỏi khu vực có breadcrumb (ví dụ đăng xuất về `/login`, ngoài `BreadcrumbProvider`) thì
  // trả tiêu đề tab về mặc định — tránh tiêu đề "đứng hình" ở trang cuối cùng đã xem.
  useEffect(() => {
    return () => {
      document.title = APP_NAME;
    };
  }, []);

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
