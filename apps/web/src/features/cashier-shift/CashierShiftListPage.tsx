import { useState } from 'react';
import { Clock, CurrencyCircleDollar, Receipt, Warning } from '@phosphor-icons/react';
import type { CashierShiftListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { useCashierShiftListQuery } from './cashier-shift.queries';
import { CashierShiftDetailDialog } from './CashierShiftDetailDialog';

/** Chỉ 2 vai trò có `cashier_shift.create` (xem `packages/core/src/rbac/permissions.ts`) mới thực sự mở/chốt ca được. */
const CASHIER_ROLES = ['receptionist', 'clinic_admin'];

const ROW_HEIGHT_PX = 60;
type StatusTab = 'all' | 'ok' | 'bad';

function monthStartDateString(): string {
  return `${getVietnamTodayDateString().slice(0, 7)}-01`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} ${dd}/${mm}`;
}

function matchesSearch(item: CashierShiftListItem, q: string): boolean {
  if (q === '') return true;
  const needle = q.trim().toLowerCase();
  return item.shiftNo.toLowerCase().includes(needle) || item.cashierName.toLowerCase().includes(needle);
}

/**
 * "Danh sách phiếu chốt ca" (Quản lý/Kế toán) — tra cứu lịch sử, xử lý chênh lệch, duyệt phiếu.
 * Mockup duyệt 2026-09-03. Bộ lọc "Thu ngân" (03/09/2026, bổ sung sau — dùng lại `GET /users` có
 * sẵn thay vì dựng endpoint liệt kê thu ngân riêng, đúng khuôn `ActivityLogPage.tsx`; trang này chỉ
 * `clinic_admin` truy cập được nên chắc chắn có sẵn `user_account.read`).
 */
export function CashierShiftListPage() {
  useBreadcrumb([{ label: 'Thu ngân' }, { label: 'Phiếu chốt ca' }]);

  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());
  const [tab, setTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usersQuery = useUserAccountsQuery();
  const cashiers = (usersQuery.data?.items ?? []).filter((u) => u.roleNames.some((r) => CASHIER_ROLES.includes(r)));

  const listQuery = useCashierShiftListQuery({
    dateFrom,
    dateTo,
    status: tab === 'all' ? undefined : tab,
    cashierId: cashierId || undefined,
  });

  const items = (listQuery.data?.items ?? []).filter((item) => matchesSearch(item, search));

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phiếu chốt ca</h1>
      <p className="px-1 text-xs font-medium text-slate-500">Dành cho Quản lý / Kế toán / Chủ phòng khám — tra cứu, xử lý chênh lệch và duyệt các phiếu chốt ca do thu ngân tạo ra.</p>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900"
          />
          <span className="text-xs text-slate-400">đến</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900"
          />
        </div>
        <select
          value={cashierId}
          onChange={(e) => setCashierId(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">Tất cả thu ngân</option>
          {cashiers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.fullName}
            </option>
          ))}
        </select>
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên thu ngân, mã phiếu..."
            className="w-full rounded-md border border-slate-300 py-1.5 px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-200 px-1">
        {(
          [
            ['all', 'Tất cả'],
            ['ok', 'Khớp tiền'],
            ['bad', 'Lệch tiền'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${tab === value ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isError && <ErrorBanner message="Không tải được danh sách phiếu chốt ca." onRetry={() => void listQuery.refetch()} />}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Receipt} title="Không có phiếu chốt ca nào" description="Chưa có ca nào được chốt trong khoảng thời gian đang lọc." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu chốt ca" className="scroll-hover h-full overflow-y-auto">
            <div
              role="row"
              className="grid grid-cols-[140px_130px_1fr_120px_140px_140px_130px_130px_100px] border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
            >
              <div className="py-2.5 text-center">Mã phiếu</div>
              <div className="py-2.5 text-center">Ngày / Giờ chốt</div>
              <div className="py-2.5 text-left">Thu ngân</div>
              <div className="py-2.5 text-center">Ca</div>
              <div className="py-2.5 text-center">Tiền hệ thống</div>
              <div className="py-2.5 text-center">Tiền thực tế</div>
              <div className="py-2.5 text-center">Chênh lệch</div>
              <div className="py-2.5 text-center">Trạng thái</div>
              <div className="py-2.5 text-center">Hành động</div>
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                style={{ minHeight: ROW_HEIGHT_PX }}
                className="grid w-full grid-cols-[140px_130px_1fr_120px_140px_140px_130px_130px_100px] items-center border-b border-slate-100 px-4 text-left text-sm hover:bg-slate-50"
              >
                <div className="text-center font-semibold text-slate-800">{item.shiftNo}</div>
                <div className="text-center font-medium text-slate-700">{item.closedAt ? formatDateTime(item.closedAt) : '—'}</div>
                <div className="truncate font-medium text-slate-900">{item.cashierName}</div>
                <div className="text-center font-medium text-slate-600">{item.shiftLabel}</div>
                <div className="text-center font-medium text-slate-700">{item.expectedCashAmount !== null ? formatVnd(item.expectedCashAmount) : '—'}</div>
                <div className="text-center font-bold text-slate-900">{item.countedCashAmount !== null ? formatVnd(item.countedCashAmount) : '—'}</div>
                <div className={`text-center font-bold ${item.cashDiscrepancyAmount === 0 ? 'text-slate-300' : 'text-rose-600'}`}>
                  {item.cashDiscrepancyAmount === 0 ? '—' : formatVnd(item.cashDiscrepancyAmount)}
                </div>
                <div className="text-center">
                  <StatusBadge tone={item.status === 'APPROVED' ? 'success' : 'warning'}>{item.status === 'APPROVED' ? 'Đã duyệt' : 'Đã chốt'}</StatusBadge>
                  {item.editedAt && <StatusBadge tone="info">Đã chỉnh sửa</StatusBadge>}
                </div>
                <div className="text-center text-xs font-semibold text-blue-600">Xem</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {listQuery.isSuccess && (
        <div className="flex flex-shrink-0 flex-wrap items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-w-[170px] flex-1 items-center justify-center gap-3 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Receipt size={20} weight="regular" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tổng số ca</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{listQuery.data.totalCount} ca</span>
            </div>
          </div>
          <div className="flex min-w-[170px] flex-1 items-center justify-center gap-3 border-l border-slate-100 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CurrencyCircleDollar size={20} weight="regular" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Tổng tiền mặt nộp về</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{formatVnd(listQuery.data.totalSubmittedAmount)}</span>
            </div>
          </div>
          <div className="flex min-w-[170px] flex-1 items-center justify-center gap-3 border-l border-slate-100 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Clock size={20} weight="regular" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Chờ duyệt</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{listQuery.data.pendingApprovalCount} ca</span>
            </div>
          </div>
          <div className="flex flex-none items-center gap-3 self-stretch bg-rose-600 px-5 py-3.5 text-white">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
              <Warning size={18} weight="fill" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-rose-100">Có chênh lệch — cần xử lý</span>
              <span className="text-xl font-bold tabular-nums">
                {listQuery.data.discrepancyCount} ca · {formatVnd(listQuery.data.discrepancyTotalAmount)}
              </span>
            </div>
          </div>
        </div>
      )}

      {selectedId && <CashierShiftDetailDialog id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
