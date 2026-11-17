import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatBytes } from './patient-document-view';
import { usePatientDocumentUsageQuery } from './patient-document.queries';

/**
 * Phần trăm Ổ CHỨA KHO đã đầy (0–100, làm tròn) = (tổng − còn trống) ÷ tổng; `null` khi kho không báo dung lượng ổ. Đây là tín hiệu "ổ sắp đầy" để quản trị lo thêm ổ cho dữ liệu và bản sao lưu —
 * khác dòng chữ bên dưới (dung lượng riêng của các tệp gắn bệnh nhân). Thuần để kiểm bằng unit test.
 */
export function diskUsedPercent(volumeTotalBytes: number | null, volumeFreeBytes: number | null): number | null {
  if (volumeTotalBytes === null || volumeFreeBytes === null || volumeTotalBytes <= 0) return null;
  const used = ((volumeTotalBytes - volumeFreeBytes) / volumeTotalBytes) * 100;
  return Math.min(100, Math.max(0, Math.round(used)));
}

/** "12,4 GB · 4.310 tệp". */
export function usageText(totalBytes: number, fileCount: number): string {
  return `${formatBytes(totalBytes)} · ${fileCount.toLocaleString('vi-VN')} tệp`;
}

/**
 * Dòng "Dung lượng đã dùng" ở Cấu hình chung (mockup màn 13): dòng chữ là tổng dung lượng và số tệp gắn bệnh nhân của công ty (tệp tải tay, kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện);
 * thanh là phần trăm Ổ CHỨA KHO đã đầy (chủ dự án chọn phương án B ngày 16/11/2026) — để quản trị biết khi nào cần thêm ổ cho dữ liệu và bản sao lưu. Chỉ người có quyền xem Cấu hình chung (`clinic_config.read`) mở được; lỗi hiện tại chỗ kèm "Thử lại".
 */
export function PatientDocumentUsageRow() {
  const usage = usePatientDocumentUsageQuery();
  const data = usage.data;
  const percent = data ? diskUsedPercent(data.volumeTotalBytes, data.volumeFreeBytes) : null;

  return (
    <div className="flex items-start justify-between gap-5">
      <div>
        <p className="text-[14.5px] font-semibold text-slate-900">Dung lượng đã dùng</p>
        <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">Gồm cả ảnh kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện.</p>
      </div>
      <div className="flex w-[260px] flex-shrink-0 flex-col gap-1.5">
        {usage.isLoading && (
          <>
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-4 w-32" />
          </>
        )}
        {usage.isError && <ErrorBanner message="Không tải được dung lượng đã dùng." onRetry={() => void usage.refetch()} />}
        {data && (
          <>
            {percent !== null && (
              <div className="h-2 w-full overflow-hidden rounded bg-slate-200" role="img" aria-label={`Ổ chứa kho đã đầy ${percent}%`}>
                <div className="h-full bg-blue-600" style={{ width: `${percent}%` }} />
              </div>
            )}
            <p className="text-[13px] font-medium text-slate-500 tabular-nums">{usageText(data.totalBytes, data.fileCount)}</p>
          </>
        )}
      </div>
    </div>
  );
}
