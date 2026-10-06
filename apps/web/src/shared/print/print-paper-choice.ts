import { create } from 'zustand';
import type { PrintDocumentType, PrintPaperSize } from '@nexamed/shared';

/**
 * Khổ giấy người dùng chọn CHO LẦN IN HIỆN TẠI (docs/DECISIONS.md #211) — chọn ở nút "In ▾" (`PrintButton`), `PrintDocument`
 * ưu tiên khổ này thay vì bản mẫu mặc định. Chỉ áp dụng MỘT lần: sự kiện `afterprint` của trình duyệt (kể cả khi huỷ hộp
 * thoại in) xoá hết lựa chọn (`AppShell`), nên không chọn gì thì lần in sau luôn theo khổ mặc định đã cấu hình.
 */
interface PrintPaperChoiceState {
  choice: Partial<Record<PrintDocumentType, PrintPaperSize>>;
  setChoice: (documentType: PrintDocumentType, paperSize: PrintPaperSize | null) => void;
  clear: () => void;
}

export const usePrintPaperChoice = create<PrintPaperChoiceState>((set) => ({
  choice: {},
  setChoice: (documentType, paperSize) =>
    set((state) => {
      const next = { ...state.choice };
      if (paperSize === null) delete next[documentType];
      else next[documentType] = paperSize;
      return { choice: next };
    }),
  clear: () => set({ choice: {} }),
}));
