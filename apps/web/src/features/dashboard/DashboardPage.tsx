import { CalendarBlank } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';

/**
 * Trang tổng quan sau đăng nhập — empty state (không bịa số liệu), vì patient/appointment/
 * encounter chưa tồn tại tới S2-S3. Thay bằng thẻ thống kê thật khi các module đó ra đời.
 */
export function DashboardPage() {
  useBreadcrumb([{ label: 'Tổng quan' }]);

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <h1 className="sr-only">Tổng quan</h1>
      <EmptyState
        icon={CalendarBlank}
        title="Chưa có dữ liệu để hiển thị"
        description="Lịch hẹn, hàng đợi tiếp nhận và lượt khám hôm nay sẽ hiện ở đây khi các module tương ứng ra đời (giai đoạn sau)."
      />
    </div>
  );
}
