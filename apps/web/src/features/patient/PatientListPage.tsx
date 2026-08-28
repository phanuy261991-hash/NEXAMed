import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Users } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { usePatientsQuery } from './patient.queries';
import { computeBirthYear, formatAddressLine } from './patient-form.utils';
import { useAllWardsQuery, useProvincesQuery } from '../geo/geo.queries';

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
/**
 * Thứ tự cột (docs/DECISIONS.md #034): chọn dòng, Mã BN, Họ tên, CCCD, Giới tính, Năm sinh, Điện
 * thoại, Địa chỉ. Hai cột dài (Họ tên, Địa chỉ) CÙNG chia phần rộng còn lại (`minmax(0,*fr)`) thay
 * vì một cột `1fr` duy nhất nuốt hết chiều rộng — đó là nguyên nhân khoảng cách quá rộng ở bản
 * trước (màn hình đã bỏ `max-w`, 1fr một mình kéo giãn ra toàn bộ phần dư). Cột đầu (chọn dòng) để
 * sẵn cho hành động hàng loạt sau này, chưa có hành động nào dùng tới.
 */
const GRID_COLUMNS = '40px 130px minmax(0,1.3fr) 120px 90px 90px 130px minmax(0,1.6fr)';
const ROW_HEIGHT_PX = 60;

/**
 * Danh sách + tìm kiếm bệnh nhân (PAT-02) — List Screen Pattern (.claude/docs/ui-guidelines.md
 * mục 9, docs/DECISIONS.md #027): rộng gần hết chiều ngang (không `max-w`), bảng cố định chiều
 * cao dưới tiêu đề/tìm kiếm, cuộn bên trong. KHÔNG có nút "Thêm bệnh nhân" — tạo mới chuyển sang
 * gắn với luồng Đặt lịch/Tiếp nhận (chưa xây). Mở hồ sơ bằng double-click vào mã bệnh nhân (không
 * phải click cả hàng), tương đương bàn phím Tab+Enter.
 *
 * Bảng dựng bằng CSS Grid (không phải `<table>`) để phối hợp được với virtualization
 * (`@tanstack/react-virtual` định vị từng hàng bằng `position: absolute`, kỹ thuật không tương
 * thích tốt với layout `<table>` gốc) — giữ vai trò ARIA tương ứng (`table`/`row`/`cell`) để công
 * cụ hỗ trợ vẫn đọc được như bảng.
 */
export function PatientListPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Danh sách bệnh nhân' }]);

  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const query = usePatientsQuery(debouncedQ);

  // Bảng tra code→tên cho cột Địa chỉ (docs/DECISIONS.md #038) — `patient.address.province`/
  // `.ward` lưu mã, không lưu tên. Tải 1 lần, cache mãi (`staleTime: Infinity`), memo hoá thành
  // Record để formatAddressLine tra O(1) mỗi hàng thay vì Array.find trong danh sách ~3321 dòng.
  const provincesQuery = useProvincesQuery();
  const wardsQuery = useAllWardsQuery();
  const provinceNameByCode = useMemo(
    () => Object.fromEntries((provincesQuery.data?.items ?? []).map((p) => [p.code, p.name])),
    [provincesQuery.data],
  );
  const wardNameByCode = useMemo(
    () => Object.fromEntries((wardsQuery.data?.items ?? []).map((w) => [w.code, w.name])),
    [wardsQuery.data],
  );

  const patients = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const patientIds = useMemo(() => patients.map((p) => p.id), [patients]);
  const rowSelection = useRowSelection(patientIds);
  const hasNextPage = query.hasNextPage ?? false;
  const rowCount = hasNextPage ? patients.length + 1 : patients.length;

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows[virtualRows.length - 1]?.index;

  // Cuộn tới đâu tự tải thêm tới đó (tối thiểu 50 bản ghi/lần — PATIENT_LIST_LIMIT), thay nút
  // "Tải thêm" thủ công — phân trang vẫn là cursor (.claude/docs/architecture.md), không offset.
  useEffect(() => {
    if (lastVirtualRowIndex === undefined) return;
    if (lastVirtualRowIndex >= patients.length - 1 && hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [lastVirtualRowIndex, patients.length, hasNextPage, query.isFetchingNextPage, query]);

  function openPatient(id: string) {
    navigate(`/patients/${id}`);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    if (event.key === 'Enter') {
      openPatient(id);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="sr-only">Danh sách bệnh nhân</h1>

      <div className="flex-shrink-0 px-1">
        <div className="relative max-w-md">
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tên, số điện thoại, hoặc mã bệnh nhân..."
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {query.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <ErrorBanner
          message={query.error instanceof ApiError ? query.error.message : 'Không tải được danh sách bệnh nhân.'}
          onRetry={() => void query.refetch()}
        />
      )}

      {query.isSuccess && patients.length === 0 && (
        <EmptyState
          icon={Users}
          title={debouncedQ ? 'Không tìm thấy bệnh nhân phù hợp' : 'Chưa có bệnh nhân nào'}
          description={
            debouncedQ
              ? 'Thử tìm với từ khoá khác.'
              : 'Bệnh nhân mới được thêm khi đặt lịch hẹn hoặc tiếp nhận.'
          }
        />
      )}

      {query.isSuccess && patients.length > 0 && (
        <div
          className={`min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-opacity ${
            query.isPlaceholderData ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div role="table" aria-label="Danh sách bệnh nhân" className="flex h-full flex-col">
            <div
              role="row"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
              className="grid flex-shrink-0 gap-x-4 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
            >
              <div role="columnheader" className="flex items-center justify-center py-2.5">
                <SelectionCheckbox
                  checked={rowSelection.allLoadedSelected}
                  indeterminate={rowSelection.someLoadedSelected}
                  onChange={rowSelection.toggleAll}
                  ariaLabel="Chọn tất cả"
                />
              </div>
              <div role="columnheader" className="py-2.5 text-center">Mã bệnh nhân</div>
              <div role="columnheader" className="py-2.5 text-center">Họ tên</div>
              <div role="columnheader" className="py-2.5 text-center">CCCD</div>
              <div role="columnheader" className="py-2.5 text-center">Giới tính</div>
              <div role="columnheader" className="py-2.5 text-center">Năm sinh</div>
              <div role="columnheader" className="py-2.5 text-center">Điện thoại</div>
              <div role="columnheader" className="py-2.5 text-center">Địa chỉ</div>
            </div>

            <div ref={scrollParentRef} className="scroll-hover flex-1 overflow-y-auto">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {virtualRows.map((virtualRow) => {
                  const patient = patients[virtualRow.index];
                  const rowStyle = {
                    position: 'absolute' as const,
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  };

                  if (!patient) {
                    return (
                      <div key="loading-sentinel" style={rowStyle} className="flex items-center justify-center gap-2 text-xs text-slate-400">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500" aria-hidden="true" />
                        Đang tải thêm bệnh nhân…
                      </div>
                    );
                  }

                  return (
                    <div
                      key={patient.id}
                      role="row"
                      tabIndex={0}
                      onKeyDown={(e) => onRowKeyDown(e, patient.id)}
                      style={{ ...rowStyle, gridTemplateColumns: GRID_COLUMNS }}
                      className="grid items-center gap-x-4 border-b border-slate-100 px-4 text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500/40"
                    >
                      <div role="cell" className="flex items-center justify-center">
                        <SelectionCheckbox
                          checked={rowSelection.isSelected(patient.id)}
                          onChange={() => rowSelection.toggle(patient.id)}
                          ariaLabel={`Chọn ${patient.fullName}`}
                        />
                      </div>
                      <div
                        role="cell"
                        onDoubleClick={() => openPatient(patient.id)}
                        className="cursor-pointer text-center font-medium text-blue-600 hover:text-blue-700"
                      >
                        {patient.patientCode}
                      </div>
                      <div role="cell" className="truncate font-medium text-slate-900">{patient.fullName}</div>
                      <div role="cell" className="text-center font-medium text-slate-600">{patient.nationalIdMasked ?? '—'}</div>
                      <div role="cell" className="text-center font-medium text-slate-600">{GENDER_LABEL[patient.gender]}</div>
                      <div role="cell" className="text-center font-medium text-slate-600">{computeBirthYear(patient.dob)}</div>
                      <div role="cell" className="text-center font-medium text-slate-600">{patient.phone}</div>
                      <div role="cell" className="truncate font-medium text-slate-600">
                        {formatAddressLine(patient.address, provinceNameByCode, wardNameByCode) || '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />
    </div>
  );
}