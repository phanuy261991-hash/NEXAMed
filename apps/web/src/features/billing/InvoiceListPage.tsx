import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft, CaretRight, MagnifyingGlass, Receipt, Warning } from '@phosphor-icons/react';
import type { BillingListItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatVnd } from '../../shared/format/currency';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { addDays, formatDateLabel, getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useBillingInvoiceListQuery } from './invoice.queries';

/** Cùng khuôn `ReceptionListPage.tsx` (List Screen Pattern, .claude/docs/ui-guidelines.md mục 9).
 * Cột đầu (chọn dòng) để sẵn cho hành động hàng loạt sau này, chưa có hành động nào dùng tới. */
const GRID_COLUMNS = '40px 170px 1.4fr 190px 170px 150px 130px 120px';
const TABLE_MIN_WIDTH_PX = 1170;
const ROW_HEIGHT_PX = 60;

type StatusTab = 'UNPAID' | 'PAID' | 'ALL';

/** #085 — nhãn/tone cho cả 4 trạng thái, dùng chung cho cột "Trạng thái" (nền đặc, #105). */
const STATUS_META: Record<BillingListItem['status'], { label: string; tone: StatusBadgeTone }> = {
  UNPAID: { label: 'Chờ thu', tone: 'warning' },
  PAID: { label: 'Đã thu', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ (chưa thu)', tone: 'neutral' },
  REFUNDED: { label: 'Đã hoàn tiền', tone: 'accent' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} ${dd}/${mm}`;
}

function matchesSearch(item: BillingListItem, q: string): boolean {
  if (q === '') return true;
  const needle = q.trim().toLowerCase();
  return (
    item.invoiceNo.toLowerCase().includes(needle) ||
    item.encounterNo.toLowerCase().includes(needle) ||
    item.fullName.toLowerCase().includes(needle) ||
    item.patientCode.toLowerCase().includes(needle)
  );
}

/**
 * "Thu ngân" (Sprint 5/6, BIL-01→04) — danh sách phiếu thu trong ngày (tự động tạo lúc tiếp
 * nhận, xem `reception.service.ts`), đồng thời là màn tổng kết cuối ngày (thanh cố định phía
 * dưới). Mockup đã duyệt qua Artifact trước khi code (tham khảo bố cục MedPOS, phối lại theo
 * token/component sẵn có của NEXAMed).
 */
export function InvoiceListPage() {
  useBreadcrumb([{ label: 'Thu ngân' }]);
  const navigate = useNavigate();

  const [date, setDate] = useState(getVietnamTodayDateString());
  const [tab, setTab] = useState<StatusTab>('UNPAID');
  const [search, setSearch] = useState('');

  const listQuery = useBillingInvoiceListQuery(date);
  const allItems = listQuery.data?.items ?? [];
  const unpaidItems = allItems.filter((i) => i.status === 'UNPAID');
  const paidItems = allItems.filter((i) => i.status === 'PAID');
  const tabItems = tab === 'UNPAID' ? unpaidItems : tab === 'PAID' ? paidItems : allItems;
  const items = tabItems.filter((i) => matchesSearch(i, search));
  const itemIds = items.map((i) => i.invoiceId);
  const rowSelection = useRowSelection(itemIds);

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Thu ngân</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Ngày trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[168px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatDateLabel(date)}
          </span>
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Ngày sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setDate(getVietnamTodayDateString())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Hôm nay
          </button>
        </div>

        <div className="relative min-w-[220px] max-w-sm flex-1">
          <MagnifyingGlass size={15} weight="regular" aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, mã bệnh nhân, mã phiếu thu..."
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-200 px-1">
        {(
          [
            ['UNPAID', `Chờ thu (${unpaidItems.length})`],
            ['PAID', `Đã thu (${paidItems.length})`],
            ['ALL', `Tất cả (${allItems.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
              tab === value ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
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

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách thu ngân.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="Không có phiếu thu nào"
          description="Phiếu thu tự động sinh khi tiếp nhận lượt khám có dịch vụ đã cấu hình đơn giá."
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách thu ngân" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div
                role="row"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="flex items-center justify-center py-2.5">
                  <SelectionCheckbox
                    checked={rowSelection.allLoadedSelected}
                    indeterminate={rowSelection.someLoadedSelected}
                    onChange={rowSelection.toggleAll}
                    ariaLabel="Chọn tất cả"
                  />
                </div>
                <div role="columnheader" className="py-2.5 text-center">Mã phiếu thu</div>
                <div role="columnheader" className="py-2.5 text-center">Bệnh nhân</div>
                <div role="columnheader" className="py-2.5 text-center">Lượt khám</div>
                <div role="columnheader" className="py-2.5 text-center">Khoa</div>
                <div role="columnheader" className="py-2.5 text-center">Tổng tiền</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.invoiceId}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                  >
                    <div role="cell" className="flex items-center justify-center">
                      <SelectionCheckbox
                        checked={rowSelection.isSelected(item.invoiceId)}
                        onChange={() => rowSelection.toggle(item.invoiceId)}
                        ariaLabel={`Chọn ${item.fullName}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/billing/${item.encounterId}`)}
                      role="cell"
                      className="truncate text-center font-medium text-blue-600 hover:text-blue-700"
                    >
                      {item.invoiceNo}
                    </button>
                    <div role="cell" className="min-w-0 text-left">
                      <div className="truncate font-semibold text-slate-900">{item.fullName}</div>
                      <div className="truncate text-xs text-slate-500">{item.patientCode}</div>
                    </div>
                    <div role="cell" className="min-w-0 text-center">
                      <div className="truncate font-medium text-slate-800">{item.encounterNo}</div>
                      <div className="truncate text-xs text-slate-500">{formatDateTime(item.checkedInAt)}</div>
                    </div>
                    <div role="cell" className="truncate text-center font-medium text-slate-600">{item.departmentName}</div>
                    <div role="cell" className="text-center font-bold tabular-nums text-slate-900">{formatVnd(item.totalAmount)}</div>
                    <div role="cell" className="flex flex-col items-center gap-1 text-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                      {/* #085 — phiếu PAID của lượt khám đã huỷ nhưng chưa hoàn tiền. */}
                      {item.needsRefund && (
                        <StatusBadge tone="danger">
                          <Warning size={10} weight="fill" aria-hidden="true" /> Cần hoàn tiền
                        </StatusBadge>
                      )}
                    </div>
                    <div role="cell" className="text-center">
                      <button
                        type="button"
                        onClick={() => navigate(`/billing/${item.encounterId}`)}
                        className={
                          item.status === 'UNPAID'
                            ? 'rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700'
                            : 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                        }
                      >
                        {item.status === 'UNPAID' ? 'Thu tiền' : 'Xem'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {listQuery.isSuccess && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4.5 py-3">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Đã thu hôm nay</span>
              <span className="text-xl font-bold tabular-nums text-brand-teal">{formatVnd(listQuery.data.paidTotalAmount)}</span>
            </div>
            {/* #085 — tách riêng "Đã hoàn"/"Thực thu" (paidTotalAmount VẪN gồm cả phiếu đã hoàn —
                xem computeDailyBillingTotals ở @nexamed/core — nên phải trừ ra ở đây mới đúng số
                tiền còn lại trong két, tránh chủ phòng khám đối soát bị lệch không giải thích được). */}
            {listQuery.data.refundedTotalAmount > 0 && (
              <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Đã hoàn ({listQuery.data.refundedCount})</span>
                <span className="text-xl font-bold tabular-nums text-violet-700">-{formatVnd(listQuery.data.refundedTotalAmount)}</span>
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Thực thu</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{formatVnd(listQuery.data.netTotalAmount)}</span>
            </div>
          </div>
          <div className="text-sm text-slate-600">
            Còn <strong className="font-bold text-slate-900">{listQuery.data.unpaidCount}</strong> phiếu chờ thu · tổng{' '}
            <strong className="font-bold text-slate-900">{formatVnd(listQuery.data.unpaidTotalAmount)}</strong>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />
    </div>
  );
}
