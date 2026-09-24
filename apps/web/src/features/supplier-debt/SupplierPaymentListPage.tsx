import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, HandCoins } from '@phosphor-icons/react';
import type { CashVoucherStatus } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useSupplierDebtPaymentsQuery } from './supplier-debt.queries';

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
 * "Phiếu thanh toán NCC" (`/suppliers/payments`, Phần B — docs/DECISIONS.md #180/#182, kế hoạch kỹ
 * thuật mục 7 màn 8) — lịch sử MỌI phiếu chi/thu gắn NCC (Trả ngay lúc nhập LẪN Thanh toán công nợ
 * đứng riêng), lọc theo NCC/ngày/trạng thái. Chỉ đọc — duyệt/từ chối/huỷ phiếu vẫn làm ở trang
 * "Phiếu thu / Phiếu chi" chung (đúng RBAC `cash_voucher.approve`, khác `supplier_debt.read` gác
 * trang này).
 */
export function SupplierPaymentListPage() {
  useBreadcrumb([{ label: 'Quản lý nhà cung cấp' }, { label: 'Phiếu thanh toán NCC' }]);
  const navigate = useNavigate();

  const [supplierId, setSupplierId] = useState('');
  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());
  const [status, setStatus] = useState<CashVoucherStatus | ''>('');

  const suppliersQuery = useSuppliersQuery(true);
  const listQuery = useSupplierDebtPaymentsQuery({ supplierId: supplierId || undefined, from: dateFrom, to: dateTo, status: status || undefined });

  const supplierOptions = useMemo(
    () => [{ value: '', label: 'Tất cả nhà cung cấp' }, ...(suppliersQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))],
    [suppliersQuery.data],
  );
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phiếu thanh toán NCC</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <Combobox id="payment-filter-supplier" value={supplierId} onChange={setSupplierId} options={supplierOptions} />
        <div className="flex items-center gap-1.5">
          <DateInput id="payment-date-from" value={dateFrom} onChange={setDateFrom} dense />
          <span className="text-xs text-slate-400">đến</span>
          <DateInput id="payment-date-to" value={dateTo} onChange={setDateTo} dense />
        </div>
        <Combobox
          id="payment-filter-status"
          value={status}
          onChange={(v) => setStatus(v as CashVoucherStatus | '')}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'POSTED', label: 'Đã ghi sổ' },
            { value: 'PENDING_APPROVAL', label: 'Chờ duyệt' },
            { value: 'REJECTED', label: 'Đã từ chối' },
          ]}
        />
      </div>

      {listQuery.isSuccess && listQuery.data.pendingApprovalCount > 0 && (
        <div className="flex flex-shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-white">
          <span className="text-sm font-bold">{listQuery.data.pendingApprovalCount} phiếu chờ duyệt — duyệt tại trang "Phiếu thu / Phiếu chi"</span>
        </div>
      )}

      {listQuery.isError && <ErrorBanner message="Không tải được danh sách thanh toán." onRetry={() => void listQuery.refetch()} />}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={HandCoins} title="Chưa có khoản thanh toán nào" description="Trả ngay lúc nhập hàng hoặc lập Thanh toán công nợ ở trang chi tiết nhà cung cấp." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-4 py-2.5 text-center">Mã phiếu</th>
                  <th className="px-4 py-2.5 text-left">Nhà cung cấp</th>
                  <th className="px-4 py-2.5 text-center">Ngày</th>
                  <th className="px-4 py-2.5 text-left">Diễn giải</th>
                  <th className="px-4 py-2.5 text-center">Số tiền</th>
                  <th className="px-4 py-2.5 text-center">Trạng thái</th>
                  <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className={`border-b border-slate-200 last:border-0 ${p.voided ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2 text-center font-semibold text-slate-800">
                      {p.voucherNo}
                      {p.voided && <span className="ml-1.5 text-[11px] font-semibold text-slate-400">(đã huỷ)</span>}
                    </td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{p.supplierName}</td>
                    <td className="px-4 py-2 text-center text-slate-600">{formatDateShort(p.occurredAt)}</td>
                    <td className="px-4 py-2 text-left text-slate-700">{p.description}</td>
                    <td className={`px-4 py-2 text-center font-bold tabular-nums ${p.direction === 'INCOME' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {p.direction === 'INCOME' ? '+' : '−'}
                      {formatVnd(p.amount)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge tone={STATUS_META[p.status].tone}>{STATUS_META[p.status].label}</StatusBadge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <RowActionButton icon={Eye} label="Xem NCC" tone="neutral" onClick={() => navigate(`/suppliers/${p.supplierId}`)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
