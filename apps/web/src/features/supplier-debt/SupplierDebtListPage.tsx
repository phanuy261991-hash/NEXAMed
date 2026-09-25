import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, HandCoins, MagnifyingGlass, Scales } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { formatVnd } from '../../shared/format/currency';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { useSupplierDebtSummariesQuery } from './supplier-debt.queries';

/**
 * "Công nợ nhà cung cấp" (`/suppliers/debts`, Phần B — docs/DECISIONS.md #180/#182, kế hoạch kỹ
 * thuật mục 7 màn 7) — bảng tổng hợp CÔNG NỢ mọi NCC (khác `SupplierPane.tsx` ở `/suppliers` — trang
 * đó là quản lý HỒ SƠ NCC, "Còn nợ" chỉ là 1 cột phụ). Mặc định chỉ hiện NCC có phát sinh (còn nợ/
 * NCC nợ lại/đang chờ duyệt) — NCC đã tất toán/chưa từng mua gì ẩn bớt cho gọn, có công tắc hiện lại.
 */
export function SupplierDebtListPage() {
  useBreadcrumb([{ label: 'Quản lý nhà cung cấp' }, { label: 'Công nợ nhà cung cấp' }]);
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(true);
  const [search, setSearch] = useState('');

  const suppliersQuery = useSuppliersQuery(true);
  const summariesQuery = useSupplierDebtSummariesQuery(true);

  const rows = useMemo(() => {
    const summaryBySupplierId = new Map((summariesQuery.data?.items ?? []).map((s) => [s.supplierId, s]));
    const all = (suppliersQuery.data?.items ?? []).map((supplier) => ({ supplier, debt: summaryBySupplierId.get(supplier.id) }));
    const scoped = showAll ? all : all.filter(({ debt }) => debt && (debt.balance !== 0 || debt.pendingApprovalAmount > 0));
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(({ supplier }) => supplier.code.toLowerCase().includes(q) || supplier.name.toLowerCase().includes(q));
  }, [suppliersQuery.data, summariesQuery.data, showAll, search]);

  const totals = useMemo(() => {
    const items = summariesQuery.data?.items ?? [];
    let totalOwed = 0;
    let totalOwedBack = 0;
    let totalPending = 0;
    for (const s of items) {
      if (s.balance > 0) totalOwed += s.balance;
      else if (s.balance < 0) totalOwedBack += -s.balance;
      totalPending += s.pendingApprovalAmount;
    }
    return { totalOwed, totalOwedBack, totalPending };
  }, [summariesQuery.data]);

  const isLoading = suppliersQuery.isLoading || summariesQuery.isLoading;
  const isError = suppliersQuery.isError || summariesQuery.isError;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="sr-only">Công nợ nhà cung cấp</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã hoặc tên nhà cung cấp..."
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Hiện cả nhà cung cấp đã tất toán / chưa phát sinh
        </label>
      </div>

      {summariesQuery.isSuccess && (
        <div className="flex flex-wrap items-stretch gap-3">
          <StatCardRow
            items={[
              { icon: Scales, tone: 'rose', label: 'Tổng còn nợ', value: formatVnd(totals.totalOwed), emphasis: true },
              { icon: Scales, tone: 'blue', label: 'NCC đang nợ lại', value: formatVnd(totals.totalOwedBack) },
            ]}
          />
          {totals.totalPending > 0 && (
            <div className="flex flex-none items-center gap-3 self-stretch rounded-xl bg-amber-500 px-5 py-4 text-white">
              <span className="whitespace-nowrap text-sm font-bold">{formatVnd(totals.totalPending)} phiếu chi chờ duyệt</span>
            </div>
          )}
        </div>
      )}

      {isError && (
        <ErrorBanner
          message="Không tải được công nợ nhà cung cấp."
          onRetry={() => {
            void suppliersQuery.refetch();
            void summariesQuery.refetch();
          }}
        />
      )}

      {isLoading && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState icon={HandCoins} title="Không có nhà cung cấp nào có công nợ" description="Bật &quot;Hiện cả nhà cung cấp đã tất toán&quot; để xem toàn bộ danh sách." />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="w-28 px-4 py-2.5 text-center">Mã</th>
                  <th className="px-4 py-2.5 text-left">Nhà cung cấp</th>
                  <th className="w-36 px-4 py-2.5 text-center">Tổng tiền hàng</th>
                  <th className="w-36 px-4 py-2.5 text-center">Đã thanh toán</th>
                  <th className="w-40 px-4 py-2.5 text-center">Còn nợ</th>
                  <th className="w-36 px-4 py-2.5 text-center">Chờ duyệt</th>
                  <th className="w-24 px-4 py-2.5 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ supplier, debt }) => (
                  <tr key={supplier.id} className={`border-b border-slate-200 last:border-0 ${supplier.isActive ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2 text-center font-bold text-slate-800">{supplier.code}</td>
                    <td className="px-4 py-2 text-left font-medium text-slate-900">{supplier.name}</td>
                    <td className="px-4 py-2 text-center text-slate-700">{debt ? formatVnd(debt.totalPurchase) : '—'}</td>
                    <td className="px-4 py-2 text-center text-slate-700">{debt ? formatVnd(debt.totalPaid) : '—'}</td>
                    <td className="px-4 py-2 text-center">
                      {!debt || debt.balance === 0 ? (
                        <span className="font-semibold text-emerald-600">{debt ? 'Đã tất toán' : '—'}</span>
                      ) : debt.balance < 0 ? (
                        <span className="font-bold text-blue-700">
                          {formatVnd(Math.abs(debt.balance))} <span className="block text-[11px] font-semibold">NCC nợ lại</span>
                        </span>
                      ) : (
                        <span className="font-bold text-slate-900">{formatVnd(debt.balance)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {debt && debt.pendingApprovalAmount > 0 ? <span className="font-semibold text-amber-700">{formatVnd(debt.pendingApprovalAmount)}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/suppliers/${supplier.id}`)} />
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
