import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileMagnifyingGlass } from '@phosphor-icons/react';
import type { LabPartnerDoneRow } from '@nexamed/shared';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { DashboardPanel } from '../../shared/ui/dashboard/DashboardPanel';
import { InitialsAvatar } from '../../shared/ui/dashboard/InitialsAvatar';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useHasPermission } from '../auth/usePermission';
import { useLabPartnerEnabledQuery } from '../clinic/clinic.queries';
import { formatWaitDuration } from '../paraclinical-result/paraclinical-result-labels';
import { LabPartnerResultDialog } from './LabPartnerResultDialog';
import { useLabPartnerAwaitingQuery } from './lab-partner.queries';

const PARTNER_QUEUE_PATH = '/paraclinical/partner';

/**
 * Kết quả đối tác CHỜ BÁC SĨ DUYỆT (docs/DECISIONS.md #291 bổ sung 6): bác sĩ thấy ngay trong màn khám của bệnh nhân (`variant="encounter"`, lọc theo `encounterId`, ẩn khi không có)
 * và ở Tổng quan bác sĩ (`variant="dashboard"`, `mine` = lượt khám của chính họ). "Xem và duyệt" mở đúng hộp xem PDF + duyệt của "Gửi mẫu đối tác"; duyệt xong tự làm mới
 * (chấm số menu, hàng đợi, danh sách). Ẩn hẳn khi phòng khám tắt "Dùng đối tác xét nghiệm" hoặc người dùng không có quyền xem. Nhận dữ liệu qua tham số, dùng được ở màn khác.
 */
export function LabPartnerAwaitingBlock({ variant, encounterId, mine = false }: { variant: 'encounter' | 'dashboard'; encounterId?: string; mine?: boolean }) {
  const featureEnabled = useLabPartnerEnabledQuery().data?.enabled === true;
  const canRead = useHasPermission('lab_partner', 'read');
  const canApprove = useHasPermission('lab_result', 'approve');
  const canReturn = useHasPermission('lab_partner', 'receive');
  const query = useLabPartnerAwaitingQuery({ ...(encounterId ? { encounterId } : {}), ...(mine ? { mine: true } : {}) }, featureEnabled && canRead);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!featureEnabled || !canRead) return null;
  const items = query.data?.items ?? [];
  const open = openId ? (items.find((r) => r.itemId === openId) ?? null) : null;
  const next = open ? items.find((r) => r.itemId !== open.itemId) : undefined;

  const dialog = open && (
    <LabPartnerResultDialog
      row={open}
      hasNext={next !== undefined}
      canApprove={canApprove}
      canReturn={canReturn}
      onClose={() => setOpenId(null)}
      onApproved={(openNext) => setOpenId(openNext && next ? next.itemId : null)}
      onReturned={() => setOpenId(null)}
    />
  );

  if (variant === 'dashboard') {
    return (
      <DashboardPanel
        title="Kết quả đối tác chờ duyệt"
        badge={items.length > 0 ? <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white">{items.length}</span> : undefined}
        action={
          <Link to={PARTNER_QUEUE_PATH} className="text-blue-600 hover:text-blue-700 hover:underline">
            Mở danh sách
          </Link>
        }
        className="flex-[1_1_340px]"
      >
        {query.isError ? (
          <ErrorBanner message="Không tải được kết quả đối tác chờ duyệt." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Không có kết quả đối tác nào chờ bạn duyệt.</p>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Kết quả đối tác chờ duyệt">
            {items.slice(0, 6).map((row) => (
              <li key={row.itemId} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <InitialsAvatar name={row.patientName} />
                <div className="min-w-0 flex-grow">
                  <div className="truncate text-[15px] font-medium text-slate-900">{row.patientName}</div>
                  <div className="truncate text-[13px] text-slate-500" title={`${row.serviceName} · ${row.supplierName}`}>
                    {row.serviceName} · {row.supplierName}
                  </div>
                </div>
                <span className="w-[70px] flex-none text-right text-sm tabular-nums text-slate-500" title={`Nhận lúc ${formatShortDateTimeVn(row.receivedAt)}`}>
                  {formatWaitDuration(row.receivedAt)}
                </span>
                <Button type="button" onClick={() => setOpenId(row.itemId)} className="flex-none rounded-full! px-4! py-1.5! text-[13px]" aria-label={`Xem và duyệt kết quả của ${row.patientName}`}>
                  {canApprove ? 'Xem và duyệt' : 'Xem PDF'}
                </Button>
              </li>
            ))}
            {items.length > 6 && (
              <li className="px-3 pt-1 text-center text-[13px] text-slate-500">
                Còn {items.length - 6} kết quả nữa —{' '}
                <Link to={PARTNER_QUEUE_PATH} className="text-blue-600 hover:underline">
                  mở danh sách
                </Link>
              </li>
            )}
          </ul>
        )}
        {dialog}
      </DashboardPanel>
    );
  }

  // Màn khám: không có việc chờ thì không chiếm chỗ.
  if (query.isError) return <ErrorBanner message="Không tải được kết quả đối tác của lượt khám này." onRetry={() => void query.refetch()} />;
  if (items.length === 0) return null;
  return (
    <section aria-label="Kết quả đối tác chờ duyệt" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50">
      <div className="flex items-center gap-2 border-b border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-900">
        <FileMagnifyingGlass size={18} weight="fill" className="flex-none text-emerald-600" aria-hidden="true" />
        Đã có kết quả đối tác, chờ duyệt ({items.length})
      </div>
      <ul className="divide-y divide-emerald-100">
        {items.map((row: LabPartnerDoneRow) => (
          <li key={row.itemId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900" title={row.serviceName}>
                {row.serviceName}
              </div>
              <div className="truncate text-[12.5px] text-slate-600">
                {row.supplierName} · nhận lúc {formatShortDateTimeVn(row.receivedAt)}
              </div>
            </div>
            <Button type="button" onClick={() => setOpenId(row.itemId)}>
              {canApprove ? 'Xem và duyệt' : 'Xem PDF'}
            </Button>
          </li>
        ))}
      </ul>
      {dialog}
    </section>
  );
}
