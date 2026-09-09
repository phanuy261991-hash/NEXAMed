import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowCircleDown, ArrowCircleUp, MagnifyingGlass, UsersThree, Wallet } from '@phosphor-icons/react';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Button } from '../../shared/ui/Button';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { StatCardRow, type StatCardItem } from '../../shared/ui/StatCard';
import { formatVnd } from '../../shared/format/currency';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatWalletDate } from './wallet-format';
import { useWalletListQuery } from './patient-wallet.queries';

type StatusFilter = 'ACTIVE' | 'CLOSED' | undefined;

/**
 * "Ví tạm ứng" tổng hợp toàn phòng khám (Sổ quỹ & Thu chi) — danh sách bệnh nhân đang có ví + KPI,
 * đúng mockup Artifact màn 5 đã chốt. Quyền `patient_wallet.settle` (chỉ clinic_admin).
 */
export function WalletListPage() {
  useBreadcrumb([{ label: 'Sổ quỹ & Thu chi' }, { label: 'Ví tạm ứng' }]);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const debouncedSearch = useDebouncedValue(search);

  const query = useWalletListQuery({ q: debouncedSearch || undefined, status });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const firstPage = query.data?.pages[0];

  const kpis: StatCardItem[] = [
    { icon: Wallet, tone: 'blue', label: 'Đang giữ hộ khách', value: formatVnd(firstPage?.totalHeldBalance ?? 0), emphasis: true },
    { icon: UsersThree, tone: 'slate', label: 'Ví hoạt động', value: String(firstPage?.activeWalletCount ?? 0) },
    { icon: ArrowCircleDown, tone: 'emerald', label: 'Nạp hôm nay', value: formatVnd(firstPage?.toppedUpToday ?? 0) },
    { icon: ArrowCircleUp, tone: 'rose', label: 'Cấn trừ hôm nay', value: formatVnd(firstPage?.deductedToday ?? 0) },
  ];

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h1 className="sr-only">Ví tạm ứng</h1>

      <div className="flex flex-shrink-0 flex-wrap items-stretch gap-3">
        <StatCardRow items={kpis} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-500 sm:w-80">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, mã bệnh nhân hoặc số điện thoại"
            className="w-full text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { value: 'ACTIVE' as StatusFilter, label: 'Đang hoạt động' },
              { value: 'CLOSED' as StatusFilter, label: 'Đã khoá' },
              { value: undefined, label: 'Tất cả' },
            ] as const
          ).map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                status === f.value ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {query.isError && <ErrorBanner message="Không tải được danh sách ví." onRetry={() => void query.refetch()} />}

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {query.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Chưa có bệnh nhân nào đang có ví tạm ứng.</p>
        ) : (
          <div className="scroll-hover h-full overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                  <th className="px-3 py-2.5 text-center">Mã bệnh nhân</th>
                  <th className="px-3 py-2.5 text-left">Họ tên</th>
                  <th className="px-3 py-2.5 text-center">Số điện thoại</th>
                  <th className="px-3 py-2.5 text-right">Số dư</th>
                  <th className="px-3 py-2.5 text-right">Đã nạp</th>
                  <th className="px-3 py-2.5 text-right">Đã dùng</th>
                  <th className="px-3 py-2.5 text-center">Giao dịch gần nhất</th>
                  <th className="px-3 py-2.5 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.walletId}
                    onDoubleClick={() => navigate(`/patients/${item.patientId}`)}
                    className="cursor-pointer border-b border-slate-100 font-medium last:border-0 hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-center">
                      <span className="font-medium text-blue-600">{item.patientCode}</span>
                    </td>
                    <td className="px-3 py-3 text-left text-slate-900">{item.fullName}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-slate-700">{item.phone ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-slate-900">{formatVnd(item.balance)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{formatVnd(item.totalToppedUp)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{formatVnd(item.totalUsed)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-slate-600">{item.lastTransactionAt ? formatWalletDate(item.lastTransactionAt) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center">
                      <StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{item.status === 'ACTIVE' ? 'Hoạt động' : 'Đã tất toán'}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.hasNextPage && (
              <div className="px-5 py-3 text-center">
                <Button type="button" variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Tải thêm
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
