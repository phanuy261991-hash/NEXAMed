import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Lock, Stethoscope } from '@phosphor-icons/react';
import type { PatientEncounterHistoryItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { useColumnVisibility } from '../../shared/hooks/useColumnVisibility';
import { Button } from '../../shared/ui/Button';
import { ColumnVisibilityMenu, type ColumnVisibilityOption } from '../../shared/ui/ColumnVisibilityMenu';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { useAppConfig } from '../../app/AppConfigProvider';
import { ENCOUNTER_STATUS_META } from '../reception/encounter-status';
import { EncounterHistoryDetailDialog } from '../encounter/EncounterHistoryDetailDialog';
import { formatDateStringVi, toVietnamDateString, vietnameseWeekdayLabel } from '../encounter/follow-up-date';
import { usePatientEncounterHistoryQuery } from '../encounter/encounter.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';

type Filter = 'COMPLETED' | 'ALL';
type OptionalColumnKey = 'conclusion' | 'followup' | 'rx' | 'cls' | 'cost' | 'paid';

const OPTIONAL_COLUMNS: (ColumnVisibilityOption & { key: OptionalColumnKey; needs: 'clinical' | 'billing' })[] = [
  { key: 'conclusion', label: 'Kết luận', group: 'Lâm sàng', needs: 'clinical' },
  { key: 'followup', label: 'Hẹn tái khám', group: 'Lâm sàng', needs: 'clinical' },
  { key: 'rx', label: 'Đơn thuốc', group: 'Lâm sàng', needs: 'clinical' },
  { key: 'cls', label: 'Cận lâm sàng', group: 'Lâm sàng', needs: 'clinical' },
  { key: 'cost', label: 'Tổng chi phí', group: 'Chi phí', needs: 'billing' },
  { key: 'paid', label: 'Thu tiền', group: 'Chi phí', needs: 'billing' },
];

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  /** Cột cố định (luôn hiện) hoặc tuỳ chọn (theo ô chọn "Cột hiển thị"). */
  optional?: OptionalColumnKey;
  /** Cần quyền lâm sàng mới có (cột cố định nhưng chứa nội dung lâm sàng: chẩn đoán, thao tác xem). */
  clinicalOnly?: boolean;
  sticky?: 'left' | 'right';
  align: 'center' | 'left';
}

const COLUMNS: ColumnDef[] = [
  { key: 'date', label: 'Ngày khám', width: 120, sticky: 'left', align: 'center' },
  { key: 'no', label: 'Mã lượt khám', width: 130, align: 'center' },
  { key: 'service', label: 'Dịch vụ khám', width: 180, align: 'center' },
  { key: 'doctor', label: 'Bác sĩ · Khoa', width: 190, align: 'left' },
  { key: 'reason', label: 'Lý do khám', width: 210, align: 'left' },
  { key: 'diagnosis', label: 'Chẩn đoán chính', width: 270, clinicalOnly: true, align: 'left' },
  { key: 'conclusion', label: 'Kết luận', width: 230, optional: 'conclusion', align: 'left' },
  { key: 'followup', label: 'Hẹn tái khám', width: 150, optional: 'followup', align: 'center' },
  { key: 'rx', label: 'Đơn thuốc', width: 150, optional: 'rx', align: 'center' },
  { key: 'cls', label: 'Cận lâm sàng', width: 150, optional: 'cls', align: 'center' },
  { key: 'cost', label: 'Tổng chi phí', width: 140, optional: 'cost', align: 'center' },
  { key: 'paid', label: 'Thu tiền', width: 130, optional: 'paid', align: 'center' },
  { key: 'status', label: 'Trạng thái', width: 120, align: 'center' },
  { key: 'action', label: 'Thao tác', width: 90, clinicalOnly: true, sticky: 'right', align: 'center' },
];

const DASH = <span className="text-slate-400">—</span>;

function vietnamTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Tab "Lịch sử khám chữa bệnh" của "Hồ sơ bệnh nhân" (docs/DECISIONS.md #223, mockup Artifact đã duyệt). Bảng cuộn ngang, cột Ngày khám dính trái và Thao tác dính phải, tiêu đề
 * dính trên; mặc định chỉ lượt "Đã hoàn tất" (khớp KPI "Tổng lượt khám"), nút "Tất cả" thêm lượt đang khám/đã huỷ/không đến. Cột lâm sàng và chi phí do MÁY CHỦ quyết định theo quyền của
 * actor (`canViewClinical`/`canViewBilling` trong response) — web không tự suy từ vai trò. 6 cột tuỳ chọn bật/tắt qua "Cột hiển thị", nhớ theo tài khoản trên máy.
 */
export function PatientEncounterHistoryTab({ patientId, mergedIntoId }: { patientId: string; mergedIntoId: string | null }) {
  const [filter, setFilter] = useState<Filter>('COMPLETED');
  const [viewing, setViewing] = useState<PatientEncounterHistoryItem | null>(null);
  const query = usePatientEncounterHistoryQuery(patientId, filter);
  const receptionTypes = useReferenceCatalogQuery('RECEPTION_TYPE');
  const canCreateEncounter = useHasPermission('encounter', 'create');
  const { tenantId } = useAppConfig();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');

  const first = query.data?.pages[0];
  const canViewClinical = first?.canViewClinical ?? false;
  const canViewBilling = first?.canViewBilling ?? false;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const allowedOptions = OPTIONAL_COLUMNS.filter((o) => (o.needs === 'clinical' ? canViewClinical : canViewBilling));
  const allowedKeys = allowedOptions.map((o) => o.key);
  const columnVisibility = useColumnVisibility(`nexamed:patient-history-columns:${tenantId}:${userId}`, allowedKeys);

  const receptionTypeName = (code: string | null) => (code ? (receptionTypes.data?.items.find((i) => i.code === code)?.name ?? null) : null);

  const columns = COLUMNS.filter((c) => (!c.optional || columnVisibility.visible.has(c.optional)) && (!c.clinicalOnly || canViewClinical) && (!c.optional || allowedKeys.includes(c.optional)));
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);

  // Cuộn tới đâu tự tải thêm tới đó: một phần tử đệm cuối bảng, quan sát trong chính khung cuộn.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được lịch sử khám.'} onRetry={() => void query.refetch()} />;
  }

  const completedCount = first?.completedCount ?? 0;
  const totalCount = first?.totalCount ?? 0;

  if (totalCount === 0) {
    return mergedIntoId ? (
      <EmptyState
        icon={Stethoscope}
        title="Các lượt khám đã chuyển sang hồ sơ đích"
        description="Hồ sơ này đã được gộp vào hồ sơ khác nên mọi lượt khám nằm ở hồ sơ đích."
        action={
          <Link to={`/patients/${mergedIntoId}`}>
            <Button type="button">Xem hồ sơ đích</Button>
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon={Stethoscope}
        title="Bệnh nhân chưa có lượt khám nào"
        description="Lượt khám sẽ hiện ở đây sau khi bệnh nhân được tiếp nhận."
        action={
          canCreateEncounter ? (
            <Link to="/reception/new">
              <Button type="button">Tiếp nhận bệnh nhân</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!canViewClinical && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600">
          <Lock size={16} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
          <span>Tài khoản của bạn không có quyền xem nội dung lâm sàng — chẩn đoán, kết luận, đơn thuốc và chi tiết lượt khám được ẩn.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Lọc trạng thái lượt khám">
          {(
            [
              { id: 'COMPLETED', label: 'Đã hoàn tất', count: completedCount },
              { id: 'ALL', label: 'Tất cả', count: totalCount },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`rounded-md px-3.5 py-1.5 text-sm font-semibold ${filter === f.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label} <span className="ml-1 tabular-nums opacity-80">{f.count}</span>
            </button>
          ))}
        </div>
        <ColumnVisibilityMenu
          idPrefix="patient-history-col"
          options={allowedOptions}
          visible={columnVisibility.visible}
          onToggle={(key) => columnVisibility.toggle(key)}
          onShowAll={columnVisibility.showAll}
          hint={`Cột cơ bản (ngày, mã, dịch vụ, bác sĩ, lý do khám${canViewClinical ? ', chẩn đoán' : ''}, trạng thái) luôn hiện.`}
          footnote="Lưu cho tài khoản này trên máy"
        />
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Chưa có lượt khám đã hoàn tất" description='Chọn "Tất cả" để xem lượt đang khám, đã huỷ hoặc không đến.' />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div ref={scrollRef} className="scroll-hover max-h-[460px] overflow-auto">
            <table className="text-sm" style={{ minWidth, width: '100%' }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      style={{ width: c.width, minWidth: c.width }}
                      className={`border-b-2 border-blue-600 bg-slate-100 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-slate-800 ${
                        c.sticky === 'left' ? 'sticky left-0 z-20' : c.sticky === 'right' ? 'sticky right-0 z-20' : ''
                      }`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.encounterId} className="group border-b border-slate-100 hover:bg-slate-50">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2.5 align-middle ${c.align === 'left' ? 'text-left' : 'text-center'} ${
                          c.sticky === 'left' ? 'sticky left-0 z-[1] bg-white group-hover:bg-slate-50' : c.sticky === 'right' ? 'sticky right-0 z-[1] bg-white group-hover:bg-slate-50' : ''
                        }`}
                      >
                        {renderCell(c.key, item, receptionTypeName(item.receptionTypeCode), () => setViewing(item))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {hasNextPage && (
              <div ref={sentinelRef} className="px-3 py-3 text-center text-xs font-medium text-slate-500">
                {isFetchingNextPage ? 'Đang tải thêm…' : ' '}
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs font-medium text-slate-500">
        Mới nhất ở trên · cuộn xuống tự tải thêm · cột Ngày khám{canViewClinical ? ' và Thao tác' : ''} đứng yên khi cuộn ngang.
      </p>

      {viewing && <EncounterHistoryDetailDialog encounterId={viewing.encounterId} doctorName={viewing.doctorName} onClose={() => setViewing(null)} />}
    </div>
  );
}

function renderCell(key: string, item: PatientEncounterHistoryItem, receptionTypeName: string | null, onView: () => void) {
  const clinical = item.clinical;
  switch (key) {
    case 'date':
      return (
        <>
          <div className="font-bold tabular-nums text-brand-teal">{formatDateStringVi(toVietnamDateString(item.checkedInAt))}</div>
          <div className="text-xs font-medium tabular-nums text-slate-500">{vietnamTime(item.checkedInAt)}</div>
        </>
      );
    case 'no':
      return <span className="font-semibold text-slate-800">{item.encounterNo}</span>;
    case 'service':
      return (
        <>
          <div className="font-medium text-slate-900">{item.examTypeName ?? '—'}</div>
          {receptionTypeName && <span className="mt-0.5 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">{receptionTypeName}</span>}
        </>
      );
    case 'doctor':
      return (
        <>
          <div className="font-medium text-slate-900">{item.doctorName ?? '—'}</div>
          {item.departmentName && <div className="text-xs font-medium text-slate-500">{item.departmentName}</div>}
        </>
      );
    case 'reason':
      return item.reason ? (
        <div className="line-clamp-2 font-medium text-slate-700" title={item.reason}>
          {item.reason}
        </div>
      ) : (
        DASH
      );
    case 'diagnosis':
      return clinical?.primaryDiagnosisCode ? (
        <>
          <div className="line-clamp-2 font-medium text-slate-900" title={clinical.primaryDiagnosisName ?? undefined}>
            <strong className="font-bold">{clinical.primaryDiagnosisCode}</strong> — {clinical.primaryDiagnosisName}
          </div>
          {clinical.otherDiagnosisCount > 0 && <div className="text-xs font-semibold text-blue-600">+{clinical.otherDiagnosisCount} chẩn đoán kèm theo</div>}
        </>
      ) : (
        DASH
      );
    case 'conclusion':
      return clinical?.conclusion ? (
        <div className="line-clamp-2 font-medium text-slate-700" title={clinical.conclusion}>
          {clinical.conclusion}
        </div>
      ) : (
        DASH
      );
    case 'followup':
      return clinical?.followUpDate ? (
        <>
          <div className="font-medium text-slate-900">{formatDateStringVi(clinical.followUpDate)}</div>
          <div className="text-xs font-medium text-slate-500">{vietnameseWeekdayLabel(clinical.followUpDate)}</div>
        </>
      ) : (
        DASH
      );
    case 'rx':
      return clinical?.prescriptionNo ? (
        <>
          <div className="font-semibold text-slate-800">{clinical.prescriptionNo}</div>
          <div className="text-xs font-medium text-slate-500">{clinical.prescriptionItemCount} thuốc</div>
        </>
      ) : (
        DASH
      );
    case 'cls': {
      const cls = clinical?.paraclinical;
      if (!cls) return DASH;
      const complete = cls.withResult === cls.total;
      return (
        <>
          <div className="font-medium text-slate-900">{cls.total} dịch vụ</div>
          <div className={`text-xs font-semibold ${complete ? 'text-emerald-600' : 'text-amber-600'}`}>{complete ? 'Đủ kết quả' : `${cls.withResult}/${cls.total} có kết quả`}</div>
        </>
      );
    }
    case 'cost':
      return item.billing && item.billing.netAmount > 0 ? <span className="font-semibold tabular-nums text-slate-900">{formatVnd(item.billing.netAmount)}</span> : DASH;
    case 'paid':
      if (!item.billing) return DASH;
      return item.billing.paymentState === 'PAID' ? (
        <StatusBadge tone="success">Đã thu</StatusBadge>
      ) : item.billing.paymentState === 'UNPAID' ? (
        <StatusBadge tone="warning">Chưa thu</StatusBadge>
      ) : (
        <StatusBadge tone="accent">Có hoàn tiền</StatusBadge>
      );
    case 'status': {
      const meta = ENCOUNTER_STATUS_META[item.status];
      return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.bg} ${meta.text}`}>{meta.label}</span>;
    }
    case 'action':
      return (
        <Button type="button" variant="secondary" className="px-2.5 py-1 text-xs" onClick={onView} aria-label={`Xem lượt khám ${item.encounterNo}`}>
          <Eye size={14} weight="bold" aria-hidden="true" />
          Xem
        </Button>
      );
    default:
      return null;
  }
}
