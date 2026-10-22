import { useEffect, useState } from 'react';
import { Buildings, CalendarPlus, CheckCircle, PauseCircle, Plus } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { formatDateTimeVn } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateVn, loginHostOf } from './platform-format';
import { useTenantsQuery } from './platform.queries';

type StatusFilter = 'all' | 'active' | 'suspended';

const STATUS_ITEMS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'active', label: 'Đang hoạt động' },
  { id: 'suspended', label: 'Tạm ngưng' },
] as const;

const COLUMN_HEADERS = ['Công ty', 'Tên miền phụ', 'Liên hệ', 'Trạng thái', 'Tài khoản', 'Chi nhánh', 'Đăng nhập gần nhất', 'Thao tác'];

/** Danh sách công ty khách hàng của khu quản trị nền tảng (docs/DECISIONS.md #237) — dải số đếm, tìm theo tên/mã/người liên hệ, lọc trạng thái. Chỉ số đếm vận hành, không có dữ liệu bệnh nhân. */
export function TenantListPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const query = useTenantsQuery({ q: debouncedQ, status });
  const data = query.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="tenant-search" className="mb-1 block text-sm font-semibold text-slate-800">
              Tìm công ty
            </label>
            <input
              id="tenant-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên, mã hoặc người liên hệ"
              className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-semibold text-slate-800">Trạng thái</span>
            <SegmentedToggle items={STATUS_ITEMS} value={status} onChange={setStatus} ariaLabel="Lọc theo trạng thái công ty" />
          </div>
        </div>
        <Button type="button" onClick={() => navigate('/tenants/new')}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          Thêm công ty
        </Button>
      </div>

      {data && (
        <StatCardRow
          items={[
            { icon: Buildings, tone: 'slate', label: 'Tổng công ty', value: String(data.stats.total) },
            { icon: CheckCircle, tone: 'emerald', label: 'Đang hoạt động', value: String(data.stats.active) },
            { icon: PauseCircle, tone: 'rose', label: 'Tạm ngưng', value: String(data.stats.suspended) },
            { icon: CalendarPlus, tone: 'blue', label: 'Tạo trong 30 ngày', value: String(data.stats.createdLast30Days) },
          ]}
        />
      )}

      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <ErrorBanner message="Không tải được danh sách công ty." onRetry={() => void query.refetch()} />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={Buildings}
          title="Không có công ty nào khớp"
          description={debouncedQ || status !== 'all' ? 'Đổi từ khoá hoặc bộ lọc trạng thái.' : 'Chưa có công ty nào. Bấm "Thêm công ty" để tạo công ty đầu tiên.'}
        />
      ) : (
        <div className="scroll-hover overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b-2 border-blue-600 bg-slate-100">
              <tr>
                {COLUMN_HEADERS.map((header) => (
                  <th key={header} className="whitespace-nowrap px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.items.map((tenant) => (
                <tr key={tenant.id} onClick={() => navigate(`/tenants/${tenant.id}`)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-left">
                    <p className="font-semibold text-slate-900">{tenant.name}</p>
                    <p className="text-xs font-medium text-slate-500">
                      Mã: <span className="font-semibold text-slate-800">{tenant.code ?? '—'}</span> · từ {formatDateVn(tenant.createdAt)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-center font-semibold text-blue-700">{loginHostOf(tenant.loginUrl) ?? '—'}</td>
                  <td className="px-3 py-2.5 text-left font-medium text-slate-900">
                    {tenant.contactName ?? '—'}
                    {tenant.contactPhone && <p className="text-xs font-medium text-slate-500">{tenant.contactPhone}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusBadge tone={tenant.status === 'active' ? 'success' : 'neutral'}>{tenant.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng'}</StatusBadge>
                  </td>
                  <td className="px-3 py-2.5 text-center font-medium tabular-nums text-slate-900">{tenant.activeUserCount}</td>
                  <td className="px-3 py-2.5 text-center font-medium tabular-nums text-slate-900">{tenant.branchCount}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center font-medium tabular-nums text-slate-900">{tenant.lastLoginAt ? formatDateTimeVn(tenant.lastLoginAt) : '—'}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3 py-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/tenants/${tenant.id}`);
                      }}
                    >
                      Xem
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
