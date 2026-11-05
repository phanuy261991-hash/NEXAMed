import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PrintButton } from './PrintButton';
import { ReportTablePrintView } from './ReportTablePrintView';
import type { ReportPrintSpec } from './report-print-spec';

/**
 * Nút "In" + bản in ẩn cho một báo cáo dạng bảng (docs/DECISIONS.md #287). Hai cách dùng:
 *  - `spec`: dữ liệu đã tải đủ trên màn hình → in ngay.
 *  - `loadSpec`: dữ liệu theo trang (cuộn tải thêm) → bấm "In" mới tải đủ các trang rồi in; lỗi tải đi qua hộp báo lỗi chung của mutation (giữ nguyên màn hình hiện tại).
 * Nút luôn tắt khi chưa có dữ liệu để in.
 */
export function ReportPrintAction({ spec, loadSpec, disabled }: { spec?: ReportPrintSpec | null; loadSpec?: () => Promise<ReportPrintSpec>; disabled?: boolean }) {
  const [loaded, setLoaded] = useState<ReportPrintSpec | null>(null);
  const load = useMutation({
    mutationFn: async () => {
      if (!loadSpec) throw new Error('Thiếu loadSpec');
      return loadSpec();
    },
    onSuccess: (result) => {
      setLoaded(result);
      // Chờ React vẽ xong bản in ẩn rồi mới mở hộp in.
      setTimeout(() => window.print(), 150);
    },
  });

  const printable = loadSpec ? loaded : (spec ?? null);
  return (
    <>
      <PrintButton
        documentType="REPORT"
        disabled={disabled || (!loadSpec && !spec)}
        loading={load.isPending}
        onPrint={() => (loadSpec ? load.mutate() : window.print())}
      >
        In
      </PrintButton>
      {printable && <ReportTablePrintView spec={printable} />}
    </>
  );
}
