import type { LabPartnerPriceImportChange, LabPartnerPriceImportPreviewResponse } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/** Phần thuần của hộp "Nhập giá trả từ Excel" (docs/DECISIONS.md #291 GĐ4): nhãn kết quả, tổng hợp, tách cột khỏi lý do lỗi. Có test, không phụ thuộc React. */

export const PRICE_IMPORT_RESULT_VIEW: Record<LabPartnerPriceImportChange['result'], { label: string; tone: StatusBadgeTone }> = {
  CHANGE: { label: 'Đổi giá', tone: 'warning' },
  ADD: { label: 'Thêm mới', tone: 'success' },
  SAME: { label: 'Giữ nguyên', tone: 'neutral' },
};

export interface PriceImportTotals {
  /** Số ô giá sẽ đổi hoặc thêm mới. */
  writeCount: number;
  /** Ô giữ nguyên: bỏ trống + nhập đúng giá hiện có. */
  keepCount: number;
  errorCount: number;
  defaultChangeCount: number;
}

export function summarizePriceImport(preview: Pick<LabPartnerPriceImportPreviewResponse, 'changes' | 'blankCellCount' | 'errorRows' | 'defaultChangeCount'>): PriceImportTotals {
  const writeCount = preview.changes.filter((c) => c.result !== 'SAME').length;
  return {
    writeCount,
    keepCount: preview.blankCellCount + (preview.changes.length - writeCount),
    errorCount: preview.errorRows.length,
    defaultChangeCount: preview.defaultChangeCount,
  };
}

/** Có gì để ghi không: có ô giá đổi/thêm hoặc đổi đối tác mặc định, và file hết lỗi. */
export function canWritePriceImport(totals: PriceImportTotals): boolean {
  return totals.errorCount === 0 && (totals.writeCount > 0 || totals.defaultChangeCount > 0);
}

/** Chữ trên nút ghi: "Ghi 11 giá", hoặc "Ghi thay đổi" khi chỉ đổi đối tác mặc định. */
export function priceImportWriteLabel(totals: PriceImportTotals): string {
  return totals.writeCount > 0 ? `Ghi ${totals.writeCount} giá` : 'Ghi thay đổi';
}

/** Lý do lỗi từ máy chủ có dạng `Cột "Tên cột": nội dung` — tách để bảng lỗi có cột "Cột" riêng. Không đúng dạng thì cột rỗng. */
export function splitErrorReason(reason: string): { column: string; message: string } {
  const match = /^Cột "([^"]+)":\s*(.*)$/s.exec(reason);
  return match ? { column: match[1]!, message: match[2]! } : { column: '', message: reason };
}
