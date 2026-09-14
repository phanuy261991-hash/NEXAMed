import { Warning } from '@phosphor-icons/react';
import { useHasPermission } from '../../features/auth/usePermission';
import { useBackupStatusQuery } from '../../features/clinic/clinic.queries';

function formatDateTimeVn(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return `${hh}:${mm} ${dd}/${mo}`;
}

/**
 * S6-01 (ADM-04, docs/DECISIONS.md #141) — banner cảnh báo TOÀN CỤC (mọi trang), chỉ `clinic_admin`
 * thấy (đã hỏi và chốt qua `AskUserQuestion`). `useBackupStatusQuery` tự trả `configured: false`
 * khi máy hiện tại không chạy container `backup` (ví dụ máy dev) — banner không hiện, tránh cảnh
 * báo giả. Không có nút hành động (khác banner "Ca thu ngân mở quá lâu" ở `InvoiceListPage.tsx`
 * có nút "Chốt ca ngay") — sự cố backup không có thao tác 1-click nào để tự sửa từ trình duyệt,
 * chỉ nhắc chủ động để người cài đặt/vận hành kiểm tra hạ tầng.
 */
export function BackupStatusBanner() {
  const canView = useHasPermission('clinic_config', 'read');
  const query = useBackupStatusQuery(canView);

  if (!canView || !query.data || !query.data.configured || !query.data.needsAttention) {
    return null;
  }

  const { reason, lastSuccessAt, lastError } = query.data;
  let message: string;
  if (reason === 'LAST_RUN_FAILED') {
    message = `Lần sao lưu gần nhất thất bại${lastError ? `: ${lastError}` : ''}. Kiểm tra lại hạ tầng sao lưu.`;
  } else if (reason === 'STALE') {
    message = `Chưa có lần sao lưu thành công nào từ ${lastSuccessAt ? formatDateTimeVn(lastSuccessAt) : 'trước đó'}. Kiểm tra lại lịch sao lưu.`;
  } else {
    message = 'Chưa từng sao lưu thành công lần nào. Kiểm tra lại cấu hình sao lưu tự động.';
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-3 bg-rose-600 px-5 py-2.5 text-white">
      <Warning size={18} weight="bold" aria-hidden="true" className="shrink-0" />
      <div className="flex flex-col">
        <span className="text-sm font-bold">Sao lưu dữ liệu đang gặp vấn đề</span>
        <span className="text-xs font-medium text-rose-100">{message}</span>
      </div>
    </div>
  );
}
