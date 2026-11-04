import { CalendarBlank } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { useHasPermission } from '../auth/usePermission';
import { OwnerDashboardPage } from './OwnerDashboardPage';

/**
 * Trang tổng quan sau đăng nhập, KHÁC THEO VAI TRÒ (docs/DECISIONS.md #279): có quyền `dashboard.owner` (chủ phòng khám) → Tổng quan chủ phòng khám. Các vai trò còn lại (thu ngân, lễ tân, bác sĩ)
 * sẽ có bản riêng ở các đợt sau; trong lúc đó giữ trạng thái trống (không bịa số liệu).
 */
export function DashboardPage() {
  const isOwner = useHasPermission('dashboard', 'owner');
  return isOwner ? <OwnerDashboardPage /> : <EmptyDashboard />;
}

function EmptyDashboard() {
  useBreadcrumb([{ label: 'Tổng quan' }]);

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <h1 className="sr-only">Tổng quan</h1>
      <EmptyState
        icon={CalendarBlank}
        title="Chưa có dữ liệu để hiển thị"
        description="Trang tổng quan dành cho vai trò của bạn sẽ có ở bản cập nhật sau."
      />
    </div>
  );
}
