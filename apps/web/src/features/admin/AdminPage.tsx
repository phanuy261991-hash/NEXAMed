import { GearSix } from '@phosphor-icons/react';
import { EmptyState } from '../../shared/ui/EmptyState';

/** Trang Quản trị — empty state, ADM-01/02/03 (tài khoản/cấu hình/nhật ký) thuộc sprint sau. */
export function AdminPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Quản trị</h1>
      <EmptyState
        icon={GearSix}
        title="Tính năng quản trị chưa có ở giai đoạn này"
        description="Quản lý tài khoản, cấu hình phòng khám và nhật ký hoạt động sẽ có ở các sprint tiếp theo."
      />
    </div>
  );
}
