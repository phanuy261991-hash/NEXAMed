import { useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { DashboardSurface } from '../../shared/ui/dashboard/DashboardPanel';
import { EmptyState } from '../../shared/ui/EmptyState';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { useHasPermission } from '../auth/usePermission';
import { CashierDashboardPage } from './CashierDashboardPage';
import { OwnerDashboardPage } from './OwnerDashboardPage';

type DashboardView = 'owner' | 'cashier';

/**
 * Trang tổng quan sau đăng nhập, KHÁC THEO VAI TRÒ (docs/DECISIONS.md #279/#283): quyền `dashboard.owner` → Tổng quan chủ phòng khám, `dashboard.cashier` → Tổng quan thu ngân.
 * Tài khoản có nhiều quyền (ví dụ vai trò tuỳ biến) thấy thanh chuyển giữa các bản; bản đầu tiên theo thứ tự trên là mặc định. Lễ tân và bác sĩ sẽ có bản riêng ở các đợt sau;
 * vai trò chưa có bản nào giữ trạng thái trống (không bịa số liệu).
 */
export function DashboardPage() {
  const isOwner = useHasPermission('dashboard', 'owner');
  const isCashier = useHasPermission('dashboard', 'cashier');
  const views: Array<{ id: DashboardView; label: string }> = [
    ...(isOwner ? [{ id: 'owner' as const, label: 'Chủ phòng khám' }] : []),
    ...(isCashier ? [{ id: 'cashier' as const, label: 'Thu ngân' }] : []),
  ];
  const [chosen, setChosen] = useState<DashboardView | null>(null);
  const current = views.find((v) => v.id === chosen) ?? views[0];

  if (!current) return <EmptyDashboard />;
  return (
    <DashboardSurface>
      {views.length > 1 && (
        <div className="mx-auto flex max-w-[1400px] justify-end px-6 pt-4">
          <SegmentedToggle items={views} value={current.id} onChange={setChosen} ariaLabel="Chọn bản tổng quan" />
        </div>
      )}
      {current.id === 'owner' ? <OwnerDashboardPage /> : <CashierDashboardPage />}
    </DashboardSurface>
  );
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
