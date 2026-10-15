import { ClockCounterClockwise } from '@phosphor-icons/react';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { AuditTable } from './AuditTable';
import { useAuditLogsQuery } from './platform.queries';

/** Nhật ký vận hành nền tảng (docs/DECISIONS.md #237): mọi lần đăng nhập, tạo/sửa/khoá/mở khoá công ty, đặt lại mật khẩu quản trị — 50 thao tác gần nhất. */
export function AuditLogPage() {
  const query = useAuditLogsQuery();

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorBanner message="Không tải được nhật ký vận hành." onRetry={() => void query.refetch()} />;
  if (query.data.items.length === 0) {
    return <EmptyState icon={ClockCounterClockwise} title="Chưa có thao tác nào" description="Mọi thao tác vận hành sẽ được ghi lại ở đây." />;
  }
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <AuditTable items={query.data.items} showTenant />
      </div>
      <p className="text-xs font-medium text-slate-500">Hiển thị 50 thao tác gần nhất.</p>
    </div>
  );
}
