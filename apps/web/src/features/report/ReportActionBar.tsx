import type { ReactNode } from 'react';
import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react';
import { formatClockTime } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';

/**
 * Cụm nút bên phải thanh lọc của mọi báo cáo điều hành (mockup đã duyệt): "Số lúc HH:MM", Làm mới, Xuất Excel, In. `print` là nút In đã dựng sẵn (`ReportPrintAction` hoặc `PrintButton`) để mỗi
 * báo cáo chọn cách in phù hợp (in dữ liệu đã tải, hoặc tải đủ các trang rồi in). Số chỉ tải khi vào trang, đổi bộ lọc hoặc bấm "Làm mới" (docs/DECISIONS.md #279).
 */
export function ReportActionBar({
  generatedAt,
  onRefresh,
  refreshing,
  onExport,
  exporting,
  exportDisabled,
  exportSuffix,
  print,
}: {
  generatedAt: string | undefined;
  onRefresh: () => void;
  refreshing: boolean;
  onExport: () => void;
  exporting: boolean;
  exportDisabled: boolean;
  /** Chữ thêm sau "Xuất Excel" (ví dụ " (312 dòng)" ở Sổ khám bệnh). */
  exportSuffix?: string;
  print: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {generatedAt && <span className="text-sm text-slate-600">Số lúc {formatClockTime(generatedAt)}</span>}
      <Button type="button" variant="secondary" loading={refreshing} onClick={onRefresh}>
        <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
        Làm mới
      </Button>
      <Button type="button" variant="secondary" disabled={exportDisabled} loading={exporting} onClick={onExport}>
        <DownloadSimple size={16} weight="bold" aria-hidden="true" />
        Xuất Excel{exportSuffix}
      </Button>
      {print}
    </div>
  );
}
