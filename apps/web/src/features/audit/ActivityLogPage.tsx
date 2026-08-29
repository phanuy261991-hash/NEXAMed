import { useMemo, useState } from 'react';
import { CaretDown, CaretUp, ClockCounterClockwise, MagnifyingGlass, Warning, X } from '@phosphor-icons/react';
import type { AuditLogEntry, PatientSummary } from '@nexamed/shared';
import { formatAuditFieldValue, isHiddenAuditField, labelForAuditField } from './field-labels';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { usePatientSearchQuery } from '../patient/patient.queries';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { useAuditLogQuery } from './audit.queries';

const GRID_COLUMNS = '170px 200px 260px 1fr 40px';
const TABLE_MIN_WIDTH_PX = 1150;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${vn.getUTCFullYear()} ${hh}:${min}`;
}

/** Tìm + chọn 1 bệnh nhân để lọc — KHÔNG có lối tắt "Tạo mới" (khác `PatientPicker.tsx`, đây là bộ lọc chỉ đọc). */
function PatientFilterPicker({ value, onChange }: { value: { id: string; fullName: string } | null; onChange: (v: { id: string; fullName: string } | null) => void }) {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const searchQuery = usePatientSearchQuery(debouncedQ);

  if (value) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-900">{value.fullName}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Bỏ lọc bệnh nhân" className="text-slate-400 hover:text-slate-600">
          <X size={13} weight="bold" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-64">
      <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Lọc theo bệnh nhân…"
        className="w-full rounded-md border border-slate-300 py-1.5 pl-7 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      {debouncedQ && searchQuery.isSuccess && searchQuery.data.items.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {searchQuery.data.items.map((p: PatientSummary) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange({ id: p.id, fullName: p.fullName });
                setQ('');
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium text-slate-900">{p.fullName}</span>{' '}
              <span className="text-xs text-slate-500">{p.patientCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Bảng field đã dịch tiếng Việt thay JSON thô (chủ dự án phản hồi trực tiếp, nhiều vòng — field lạ
 * dạng mảng/object lồng nhau như `clinical_note.amended` (`sections: [{content, section, version}]`)
 * ban đầu vẫn rơi về `JSON.stringify` thô) — ĐỆ QUY vào cả mảng lẫn object con, dịch key ở MỌI cấp,
 * không chỉ cấp 1. Field ẩn (`isHiddenAuditField`) lọc ở mọi cấp.
 */
function FieldTable({ json }: { json: unknown }) {
  if (json === null || json === undefined) {
    return <p className="text-xs text-slate-400">—</p>;
  }

  if (Array.isArray(json)) {
    if (json.length === 0) {
      return <p className="text-xs text-slate-400">—</p>;
    }
    return (
      <div className="space-y-2">
        {json.map((item, i) => (
          <div key={i} className="rounded border border-slate-200 bg-white p-1.5">
            <FieldTable json={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof json === 'object') {
    const entries = Object.entries(json as Record<string, unknown>).filter(([key]) => !isHiddenAuditField(key));
    if (entries.length === 0) {
      return <p className="text-xs text-slate-400">—</p>;
    }
    return (
      <dl className="space-y-1">
        {entries.map(([key, value]) => {
          const isNested = value !== null && typeof value === 'object';
          return (
            <div key={key} className={isNested ? 'text-xs' : 'flex items-baseline justify-between gap-3 text-xs'}>
              <dt className={isNested ? 'mb-1 text-slate-500' : 'text-slate-500'}>{labelForAuditField(key)}</dt>
              <dd className={isNested ? '' : 'text-right font-medium text-slate-800'}>
                {isNested ? <FieldTable json={value} /> : formatAuditFieldValue(value)}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return <p className="text-xs font-medium text-slate-800">{formatAuditFieldValue(json)}</p>;
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = entry.beforeJson !== null || entry.afterJson !== null;

  return (
    <div role="row" className={`border-b border-slate-100 ${entry.isBreakGlass ? 'bg-rose-50' : ''}`}>
      <div style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: 52 }} className="grid items-center px-4 text-sm">
        <div role="cell" className="text-center font-medium tabular-nums text-slate-600">{formatDateTime(entry.occurredAt)}</div>
        <div role="cell" className="truncate text-center font-medium text-slate-800">{entry.actorName ?? '—'}</div>
        <div role="cell" className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
          {entry.isBreakGlass && (
            <span
              title="Thao tác phá kính (break-glass) — vượt qua kiểm tra quyền thông thường"
              className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-600 text-white"
            >
              <Warning size={12} weight="fill" aria-hidden="true" />
            </span>
          )}
          <span className="truncate">{entry.actionLabel}</span>
        </div>
        <div role="cell" className="truncate text-slate-600">{entry.entityLabel}</div>
        <div role="cell" className="flex items-center justify-center">
          {hasDetail && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Thu gọn chi tiết' : 'Xem chi tiết'}
              className="text-slate-400 hover:text-slate-700"
            >
              {expanded ? <CaretUp size={15} weight="bold" /> : <CaretDown size={15} weight="bold" />}
            </button>
          )}
        </div>
      </div>
      {expanded && hasDetail && (
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Trước khi sửa</p>
            <FieldTable json={entry.beforeJson} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sau khi sửa</p>
            <FieldTable json={entry.afterJson} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Nhật ký hoạt động" (S5-05, ADM-03) — lọc theo bệnh nhân (đầy đủ hồ sơ bệnh án, gồm cả lượt khám
 * thuộc bệnh nhân đó — xem `AuditLogRepository.list()`), theo người dùng, theo khoảng ngày. List
 * Screen Pattern (cùng khuôn `ReceptionListPage.tsx`), cursor "Tải thêm" thay vì virtualization
 * (khối lượng dữ liệu một phòng khám nhỏ, cùng lý do `useUserAccountsQuery`).
 */
export function ActivityLogPage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Nhật ký hoạt động' }]);

  const [patient, setPatient] = useState<{ id: string; fullName: string } | null>(null);
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const usersQuery = useUserAccountsQuery();
  const listQuery = useAuditLogQuery({
    patientId: patient?.id,
    actorId: actorId || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const items = useMemo(() => listQuery.data?.pages.flatMap((p) => p.items) ?? [], [listQuery.data]);
  const hasFilters = Boolean(patient || actorId || from || to);

  function clearFilters() {
    setPatient(null);
    setActorId('');
    setFrom('');
    setTo('');
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Nhật ký hoạt động</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-1">
        <PatientFilterPicker value={patient} onChange={setPatient} />
        <select
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">Tất cả người dùng</option>
          {usersQuery.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.fullName}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <span className="text-xs text-slate-400">đến</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {hasFilters && (
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={clearFilters}>
            Xoá lọc
          </Button>
        )}
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
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được nhật ký hoạt động.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={ClockCounterClockwise} title="Chưa có hoạt động nào khớp bộ lọc" description="Thử đổi bệnh nhân/người dùng/khoảng ngày đang lọc." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Nhật ký hoạt động" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div
                role="row"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="py-2.5 text-center">Thời gian</div>
                <div role="columnheader" className="py-2.5 text-center">Người thực hiện</div>
                <div role="columnheader" className="py-2.5 text-center">Hành động</div>
                <div role="columnheader" className="py-2.5 text-center">Đối tượng</div>
                <div role="columnheader" className="py-2.5" />
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
                {listQuery.hasNextPage && (
                  <div className="flex justify-center py-3">
                    <Button
                      type="button"
                      variant="secondary"
                      loading={listQuery.isFetchingNextPage}
                      onClick={() => void listQuery.fetchNextPage()}
                    >
                      Tải thêm
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
