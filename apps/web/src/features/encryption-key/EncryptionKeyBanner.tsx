import { useState } from 'react';
import { LockKey, WarningCircle } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { buildEncryptionKeyBanner, RECOVERY_STEPS } from './encryption-key-view';
import { useEncryptionKeyStatusQuery } from './encryption-key.queries';

/**
 * Cảnh báo TOÀN CỤC (mọi trang) khi khoá mã hoá hệ thống không khớp dữ liệu đã lưu (docs/DECISIONS.md #262, mockup B đã chốt 24/10/2026). Chỉ người quản trị thấy (máy chủ chỉ trả mã kiểm khoá cho họ);
 * nhân viên khác thấy dòng "Không đọc được" ngay ở trường mã hoá. Cùng khuôn `BackupStatusBanner`: tự ẩn khi không có gì cần báo.
 */
export function EncryptionKeyBanner() {
  const query = useEncryptionKeyStatusQuery();
  const [guideOpen, setGuideOpen] = useState(false);
  const view = buildEncryptionKeyBanner(query.data);
  if (!view) return null;

  return (
    <>
      <div role="alert" className="flex flex-shrink-0 items-start gap-3 border-b-2 border-rose-600 bg-rose-50 px-5 py-3">
        <WarningCircle size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-rose-600" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold text-rose-800">{view.title}</span>
          <span className="text-xs text-rose-900">{view.detail}</span>
          <span className="text-xs font-semibold text-rose-900">{view.action}</span>
        </div>
        <Button type="button" variant="danger" className="shrink-0 whitespace-nowrap px-3 py-1.5" onClick={() => setGuideOpen(true)}>
          Xem hướng dẫn khôi phục
        </Button>
      </div>
      {guideOpen && (
        <ConfirmDialog
          icon={LockKey}
          tone="danger"
          title="Khôi phục khoá hệ thống"
          rows={RECOVERY_STEPS.map((step, index) => ({ label: `Bước ${index + 1}`, value: step }))}
          note="Trong lúc khoá chưa khớp, hệ thống từ chối lưu CCCD/thẻ BHYT mới để không trộn hai khoá."
          onClose={() => setGuideOpen(false)}
          actions={
            <Button type="button" variant="secondary" onClick={() => setGuideOpen(false)}>
              Đã hiểu
            </Button>
          }
        />
      )}
    </>
  );
}
