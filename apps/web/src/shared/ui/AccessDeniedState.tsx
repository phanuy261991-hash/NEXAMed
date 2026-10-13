import { ArrowLeft, House, LockKey } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/auth.store';
import { findCurrentBranch, hasMultipleBranches } from '../../features/branch/branch-visibility';
import { Button } from './Button';

/**
 * Trang "Không có quyền xem nội dung này" (chủ dự án yêu cầu 13/10/2026, #231) — thay trang trống/EmptyState khi mở một bản ghi mà máy chủ trả 404/403. Máy chủ cố ý trả 404 cho bản ghi
 * thuộc chi nhánh khác hoặc tenant khác (không tiết lộ bản ghi có tồn tại hay không), nên lời nhắn nêu cả các nguyên nhân có thể thay vì khẳng định một nguyên nhân. Luôn có lối thoát:
 * "Quay lại trang trước" (hoặc về `fallbackTo` nếu mở thẳng bằng đường dẫn, không có trang trước) và "Về trang chủ". Công ty/tài khoản chỉ có 1 chi nhánh: không nhắc chi nhánh.
 */
export function AccessDeniedState({
  title = 'Bạn không có quyền xem nội dung này',
  description = 'Nội dung này không tồn tại, hoặc thuộc chi nhánh khác mà tài khoản của bạn không được xem, hoặc tài khoản chưa được cấp quyền. Liên hệ Quản trị viên nếu bạn cho rằng đây là nhầm lẫn.',
  fallbackTo = '/',
  fallbackLabel = 'Về trang chủ',
}: {
  title?: string;
  description?: string;
  /** Nơi quay về khi không có trang trước (mở thẳng bằng đường dẫn, mở tab mới). */
  fallbackTo?: string;
  fallbackLabel?: string;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const branchName = hasMultipleBranches(user) ? (findCurrentBranch(user)?.name ?? null) : null;

  function goBack() {
    // `idx` do react-router ghi vào history.state: > 0 nghĩa là còn trang trước trong chính ứng dụng.
    const hasPrevious = typeof window.history.state?.idx === 'number' && window.history.state.idx > 0;
    if (hasPrevious) navigate(-1);
    else navigate(fallbackTo, { replace: true });
  }

  return (
    <section aria-labelledby="access-denied-title" className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <LockKey size={32} weight="regular" aria-hidden="true" />
      </span>
      <h2 id="access-denied-title" className="mt-5 text-xl font-semibold text-slate-900">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      {branchName && (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          Chi nhánh đang làm việc: <strong className="font-semibold text-slate-900">{branchName}</strong>. Nếu nội dung thuộc chi nhánh khác, hãy đổi chi nhánh ở thanh phía trên.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="secondary" onClick={goBack}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Quay lại trang trước
        </Button>
        <Link to={fallbackTo}>
          <Button type="button">
            <House size={16} weight="bold" aria-hidden="true" />
            {fallbackLabel}
          </Button>
        </Link>
      </div>
    </section>
  );
}
