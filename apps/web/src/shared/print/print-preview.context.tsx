import { createContext, type ReactNode } from 'react';
import type { ClinicPrintHeader, ResolvedPrintTemplate } from '@nexamed/shared';

/**
 * Trang "Quản lý mẫu in" bọc bản in THẬT của từng chứng từ (cùng component đang dùng để in) trong provider này để
 * xem trước bản mẫu đang soạn bằng dữ liệu mẫu: `PrintDocument` ưu tiên bản mẫu/đầu trang trong context (thay vì bản
 * mặc định đã lưu) và hiện ngay trên màn hình thay vì chỉ lúc in. Ngoài trang quản lý, context này luôn rỗng.
 */
export interface PrintPreviewValue {
  template: ResolvedPrintTemplate;
  clinicHeader: ClinicPrintHeader;
}

export const PrintPreviewContext = createContext<PrintPreviewValue | null>(null);

export function PrintPreviewProvider({ value, children }: { value: PrintPreviewValue; children: ReactNode }) {
  return <PrintPreviewContext.Provider value={value}>{children}</PrintPreviewContext.Provider>;
}
