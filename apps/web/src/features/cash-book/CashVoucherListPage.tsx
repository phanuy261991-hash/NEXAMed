import { useMemo, useState } from 'react';
import { ArrowCircleDown, ArrowCircleUp, Plus, Receipt, Scales } from '@phosphor-icons/react';
import type { CashVoucherStatus, ReferenceCatalogDirection } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useHasPermission } from '../auth/usePermission';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { CashVoucherDetailDialog } from './CashVoucherDetailDialog';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from './CashVoucherFormDialog';
import { useCashVouchersQuery, useCreateCashVoucherMutation } from './cash-voucher.queries';

/** Cột đầu (chọn dòng) để sẵn cho hành động hàng loạt sau này, chưa có hành động nào dùng tới —
 * đúng khuôn `InvoiceListPage.tsx` (`.claude/docs/ui-guidelines.md` mục 4.6). */
const GRID_COLUMNS = '40px 150px 110px 1.2fr 1.6fr 150px 140px 130px';
const TABLE_MIN_WIDTH_PX = 1200;
const ROW_HEIGHT_PX = 56;

type DirectionTab = 'ALL' | ReferenceCatalogDirection;

const STATUS_META: Record<CashVoucherStatus, { label: string; tone: StatusBadgeTone }> = {
  POSTED: { label: 'Đã ghi sổ', tone: 'success' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

function monthStartDateString(): string {
  return `${getVietnamTodayDateString().slice(0, 7)}-01`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

/**
 * "Phiếu thu / Phiếu chi" (Sổ quỹ & Thu chi GĐ1, mockup Artifact duyệt 2026-09-05) — List Screen
 * Pattern đúng khuôn `InvoiceListPage.tsx`/`CashierShiftListPage.tsx`. Tổng kết theo bộ lọc đang
 * xem lấy trực tiếp từ response (`totalIncomeAmount`/`totalExpenseAmount`/`pendingApprovalCount`),
 * không tự cộng lại ở web.
 */
export function CashVoucherListPage() {
  useBreadcrumb([{ label: 'Sổ quỹ & Thu chi' }, { label: 'Phiếu thu / Phiếu chi' }]);
  const canCreate = useHasPermission('cash_voucher', 'create');

  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());
  const [direction, setDirection] = useState<DirectionTab>('ALL');
  const [status, setStatus] = useState<CashVoucherStatus | ''>('');
  const [createModal, setCreateModal] = useState<{ direction: ReferenceCatalogDirection } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const listQuery = useCashVouchersQuery({
    from: dateFrom,
    to: dateTo,
    direction: direction === 'ALL' ? undefined : direction,
    status: status || undefined,
  });
  const incomeExpenseTypeQuery = useReferenceCatalogQuery('INCOME_EXPENSE_TYPE', true);
  const createMutation = useCreateCashVoucherMutation();

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const rowSelection = useRowSelection(itemIds);
  const incomeExpenseTypeName = useMemo(() => {
    const map = new Map((incomeExpenseTypeQuery.data?.items ?? []).map((i) => [i.code, i.name]));
    return (code: string) => map.get(code) ?? code;
  }, [incomeExpenseTypeQuery.data]);

  async function handleCreateSubmit(dto: CashVoucherSubmitDto) {
    return createMutation.mutateAsync({
      direction: dto.direction!,
      incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
      cashAccountId: dto.cashAccountId,
      paymentMethodCode: dto.paymentMethodCode,
      amount: dto.amount,
      occurredAt: dto.occurredAt,
      partnerName: dto.partnerName,
      description: dto.description,
      note: dto.note,
    });
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phiếu thu / Phiếu chi</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex flex-wrap items-center gap-2.5">
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
          <div className="flex items-center gap-1 rounded-md border border-slate-300 p-1">
            {(
              [
                ['ALL', 'Tất cả'],
                ['INCOME', 'Thu'],
                ['EXPENSE', 'Chi'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDirection(value)}
                className={`rounded px-3 py-1 text-xs font-semibold ${direction === value ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CashVoucherStatus | '')}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">Mọi trạng thái</option>
            <option value="POSTED">Đã ghi sổ</option>
            <option value="PENDING_APPROVAL">Chờ duyệt</option>
            <option value="REJECTED">Đã từ chối</option>
          </select>
        </div>
        {canCreate && (
          <Button type="button" onClick={() => setCreateModal({ direction: 'INCOME' })}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Lập phiếu
          </Button>
        )}
      </div>

      {/* Thẻ số liệu tách rời (thay dải liền viền chia đôi cũ) — mỗi thẻ nền màu nhạt riêng để
          phân biệt rõ hơn theo mắt lướt qua. Số tiền `text-2xl font-bold`, nhãn `text-xs font-bold`
          màu đặc (không opacity) — thử `font-semibold`/nhạt hơn trước đó bị phản hồi "mỏng", chốt
          lại đậm/to rõ ràng (2026-09-06). */}
      {listQuery.isSuccess && (
        <div className="flex flex-shrink-0 flex-wrap items-stretch gap-3">
          <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-5 py-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100">
              <ArrowCircleDown size={22} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Tổng thu</span>
              <span className="truncate text-2xl font-bold tabular-nums text-emerald-700">{formatVnd(listQuery.data.totalIncomeAmount)}</span>
            </div>
          </div>
          <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-rose-100 bg-rose-50/50 px-5 py-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-rose-600 shadow-sm ring-1 ring-rose-100">
              <ArrowCircleUp size={22} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-bold uppercase tracking-wide text-rose-700">Tổng chi</span>
              <span className="truncate text-2xl font-bold tabular-nums text-rose-700">{formatVnd(listQuery.data.totalExpenseAmount)}</span>
            </div>
          </div>
          <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-blue-100 bg-blue-50/50 px-5 py-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
              <Scales size={22} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-bold uppercase tracking-wide text-blue-700">Chênh lệch</span>
              <span className="truncate text-2xl font-bold tabular-nums text-slate-900">
                {formatVnd(listQuery.data.totalIncomeAmount - listQuery.data.totalExpenseAmount)}
              </span>
            </div>
          </div>
          {listQuery.data.pendingApprovalCount > 0 && (
            <div className="flex flex-none items-center gap-3 self-stretch rounded-xl bg-amber-500 px-5 py-4 text-white">
              <span className="whitespace-nowrap text-sm font-bold">{listQuery.data.pendingApprovalCount} phiếu chờ duyệt</span>
            </div>
          )}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách phiếu thu/chi.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Receipt} title="Chưa có phiếu thu/chi nào" description="Lập phiếu để ghi nhận khoản thu/chi ngoài dịch vụ khám." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu thu/chi" className="scroll-hover h-full overflow-x-auto">
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
                <div role="columnheader" className="py-2.5 text-center">Mã phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày</div>
                <div role="columnheader" className="py-2.5 text-center">Loại thu chi</div>
                <div role="columnheader" className="py-2.5 text-left">Diễn giải</div>
                <div role="columnheader" className="py-2.5 text-center">Số tiền</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                  >
                    <div role="cell" className="flex items-center justify-center">
                      <SelectionCheckbox
                        checked={rowSelection.isSelected(item.id)}
                        onChange={() => rowSelection.toggle(item.id)}
                        ariaLabel={`Chọn ${item.voucherNo}`}
                      />
                    </div>
                    <button type="button" onClick={() => setDetailId(item.id)} role="cell" className="truncate text-center font-medium text-blue-600 hover:text-blue-700">
                      {item.voucherNo}
                    </button>
                    <div role="cell" className="text-center text-slate-600">{formatDateShort(item.occurredAt)}</div>
                    <div role="cell" className="min-w-0 text-center">
                      <span className="inline-flex items-center gap-1 truncate">
                        {item.direction === 'INCOME' ? (
                          <ArrowCircleDown size={13} weight="fill" className="flex-shrink-0 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <ArrowCircleUp size={13} weight="fill" className="flex-shrink-0 text-rose-600" aria-hidden="true" />
                        )}
                        <span className="truncate text-slate-700">{incomeExpenseTypeName(item.incomeExpenseTypeCode)}</span>
                      </span>
                    </div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900" title={item.description}>
                      {item.description}
                      {item.partnerName && <span className="ml-1.5 text-xs text-slate-400">· {item.partnerName}</span>}
                    </div>
                    <div role="cell" className={`text-center font-bold tabular-nums ${item.direction === 'INCOME' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {item.direction === 'INCOME' ? '+' : '−'}
                      {formatVnd(item.amount)}
                    </div>
                    <div role="cell" className="flex flex-col items-center gap-1 text-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                      {item.voided && <StatusBadge tone="neutral">Đã huỷ</StatusBadge>}
                    </div>
                    <div role="cell" className="text-center">
                      <button
                        type="button"
                        onClick={() => setDetailId(item.id)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Xem
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {createModal && (
        <CashVoucherFormDialog
          mode="create"
          initialDirection={createModal.direction}
          submitting={createMutation.isPending}
          onCancel={() => setCreateModal(null)}
          onSubmit={handleCreateSubmit}
        />
      )}
      {detailId && <CashVoucherDetailDialog voucherId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
