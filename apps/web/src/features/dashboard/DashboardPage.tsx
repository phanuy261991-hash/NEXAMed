import { CalendarBlank } from '@phosphor-icons/react';
import { EmptyState } from '../../shared/ui/EmptyState';

/**
 * Trang tổng quan sau đăng nhập — empty state (không bịa số liệu), vì patient/appointment/
 * encounter chưa tồn tại tới S2-S3. Thay bằng thẻ thống kê thật khi các module đó ra đời.
 */
export function DashboardPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Tổng quan</h1>
      <EmptyState
        icon={CalendarBlank}
        title="Chưa có dữ liệu để hiển thị"
        description="Lịch hẹn, hàng đợi tiếp nhận và lượt khám hôm nay sẽ hiện ở đây khi các module tương ứng ra đời (giai đoạn sau)."
      />
    </div>
  );
}
