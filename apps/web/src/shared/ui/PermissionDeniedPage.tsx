import { LockKey } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useBreadcrumb } from '../layout/breadcrumb.context';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/**
 * Chặn ở tầng ROUTE (2026-09-04, bug thu hồi quyền không có tác dụng) — khác `NotFoundPage.tsx`
 * (sai đường dẫn): actor gõ thẳng URL của route mình không còn quyền (đã bị thu hồi qua "Vai trò
 * & Phân quyền", hoặc chưa từng được cấp) vẫn phải thấy thông báo RÕ nguyên nhân, không phải trang
 * trắng hay bị điều hướng âm thầm — cùng khuôn `NotFoundPage.tsx` (EmptyState + nút "Về trang chủ").
 */
export function PermissionDeniedPage() {
  useBreadcrumb([{ label: 'Không có quyền truy cập' }]);

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <h1 className="sr-only">Không có quyền truy cập</h1>
      <EmptyState
        icon={LockKey}
        title="Không có quyền truy cập"
        description="Tài khoản của bạn không có quyền xem trang này. Liên hệ Quản trị viên nếu bạn cho rằng đây là nhầm lẫn."
        action={
          <Link to="/">
            <Button type="button">Về trang chủ</Button>
          </Link>
        }
      />
    </div>
  );
}
