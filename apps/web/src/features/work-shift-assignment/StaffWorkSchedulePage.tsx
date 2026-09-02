import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, DownloadSimple, MagnifyingGlass, Plus, UploadSimple, X as XIcon } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useUserAccountsQuery } from '../user-account/user-account.queries';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useWorkShiftsQuery } from '../clinic/clinic.queries';
import { WORK_SHIFT_COLOR_HEX } from '../clinic/WorkShiftFormModal';
import { ImportExcelDialog } from './ImportExcelDialog';
import { WorkShiftPickerModal } from './WorkShiftPickerModal';
import { exportWorkShiftAssignments } from './work-shift-assignment.api';
import { useCreateWorkShiftAssignmentMutation, useDeleteWorkShiftAssignmentMutation, useWorkShiftAssignmentsQuery } from './work-shift-assignment.queries';

function toDateOnlyUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
function fromDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function getTodayDateString(): string {
  const now = new Date();
  return fromDateOnlyUtc(new Date(now.getTime() + 7 * 60 * 60_000));
}
function formatDDMM(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
function addMonths(monthStr: string, delta: number): string {
  const [year, month] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  return `Tháng ${Number(month)}/${year}`;
}
/** Số ngày của tháng — mẹo "ngày 0 của tháng kế tiếp", cùng kỹ thuật `MyWorkSchedulePage.tsx`. */
function getDaysInMonth(monthStr: string): string[] {
  const [year, month] = monthStr.split('-').map(Number);
  const count = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${monthStr}-${String(i + 1).padStart(2, '0')}`);
}
const WEEKDAY_FULL_LABELS = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];
/** 0=CN..6=T7 (UTC) → chỉ số trong `WEEKDAY_FULL_LABELS` (0=Thứ hai). */
function weekdayLabelIndex(dateStr: string): number {
  const utcDay = toDateOnlyUtc(dateStr).getUTCDay();
  return utcDay === 0 ? 6 : utcDay - 1;
}

const NAME_COL_WIDTH = 192;
const VISIBLE_DAY_COLUMNS = 7;
const MIN_DAY_COL_WIDTH = 132;

/**
 * "Lịch làm việc nhân viên" (Giai đoạn 2 của #101) — chỉ clinic_admin (scope global) truy cập,
 * xem/tạo/xoá TOÀN BỘ nhân viên, không giới hạn thời gian (khác "Lịch làm việc của tôi"). Mọi ô
 * (kể cả đã có ca) sửa/xoá được ngay — không khoá.
 *
 * Lưới hiện NGUYÊN 1 THÁNG liên mạch (cột tên nhân viên cố định bên trái qua `position: sticky`,
 * mỗi lần chỉ thấy đúng 7 cột ngày — cùng mật độ/kích thước thẻ ca như trước) — cuộn ngang để xem
 * các tuần tiếp theo, khớp SNAP đúng ranh giới tuần (`scroll-snap-type`, không dừng giữa chừng).
 * Độ rộng mỗi cột ngày đo bằng `ResizeObserver` để luôn vừa đúng 7 cột trong khung nhìn hiện có,
 * responsive theo màn hình thay vì hardcode 1 con số.
 */
export function StaffWorkSchedulePage() {
  useBreadcrumb([{ label: 'Lịch làm việc' }, { label: 'Lịch làm việc nhân viên' }]);

  const today = getTodayDateString();
  const [monthAnchor, setMonthAnchor] = useState(() => today.slice(0, 7));
  const days = getDaysInMonth(monthAnchor);

  const [pickerTarget, setPickerTarget] = useState<{ userId: string; date: string } | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [dayColWidth, setDayColWidth] = useState(MIN_DAY_COL_WIDTH);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const width = Math.floor((el.clientWidth - NAME_COL_WIDTH) / VISIBLE_DAY_COLUMNS);
      setDayColWidth(Math.max(MIN_DAY_COL_WIDTH, width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const usersQuery = useUserAccountsQuery();
  const departmentsQuery = useDepartmentOptionsQuery();
  const shiftsQuery = useWorkShiftsQuery();
  const listQuery = useWorkShiftAssignmentsQuery(days[0]!, days[days.length - 1]!);
  const createMutation = useCreateWorkShiftAssignmentMutation();
  const deleteMutation = useDeleteWorkShiftAssignmentMutation();

  const departments = departmentsQuery.data?.items ?? [];
  const trimmedSearch = search.trim().toLowerCase();
  const staff = (usersQuery.data?.items ?? [])
    .filter((u) => u.isActive && !u.roleNames.includes('system_admin'))
    .filter((u) => !departmentFilter || u.departmentId === departmentFilter)
    .filter((u) => !trimmedSearch || (u.displayName ?? u.fullName).toLowerCase().includes(trimmedSearch));
  const workShifts = shiftsQuery.data?.items ?? [];
  const items = listQuery.data?.items ?? [];
  const itemsByUserDay = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.userId}|${item.workDate}`;
    const list = itemsByUserDay.get(key) ?? [];
    list.push(item);
    itemsByUserDay.set(key, list);
  }

  const loading = usersQuery.isPending || shiftsQuery.isPending || listQuery.isPending;
  const error = usersQuery.error ?? shiftsQuery.error ?? listQuery.error;

  async function handlePickerSave(shiftIds: string[]) {
    if (!pickerTarget) return;
    for (const workShiftId of shiftIds) {
      await createMutation.mutateAsync({ workShiftId, workDate: pickerTarget.date, userId: pickerTarget.userId });
    }
    setPickerTarget(null);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportWorkShiftAssignments(monthAnchor);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <h1 className="sr-only">Lịch làm việc nhân viên</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-700"
        >
          <option value="">Tất cả Khoa</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm nhân viên..."
            className="min-w-[200px] rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] font-medium text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
            aria-label="Tháng trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[128px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatMonthLabel(monthAnchor)}
          </span>
          <button
            type="button"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
            aria-label="Tháng sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setMonthAnchor(today.slice(0, 7))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Tháng này
          </button>
          <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden="true" />
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void handleExport()} loading={exporting}>
            <DownloadSimple size={14} weight="bold" aria-hidden="true" />
            Xuất Excel
          </Button>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setImportOpen(true)}>
            <UploadSimple size={14} weight="bold" aria-hidden="true" />
            Nhập Excel
          </Button>
        </div>
      </div>

      {!loading && !error && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-1">
          {workShifts.length > 0 && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Chú thích ca:</span>
              {workShifts.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold text-white shadow-sm"
                  style={{ background: WORK_SHIFT_COLOR_HEX[s.color] }}
                >
                  {s.name}
                  <span className="font-semibold opacity-85">
                    {s.startTime}–{s.endTime}
                  </span>
                </span>
              ))}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400">Cuộn tuần</span>
            <button
              type="button"
              aria-label="Cuộn 1 tuần trước"
              onClick={() => scrollRef.current?.scrollBy({ left: -dayColWidth * VISIBLE_DAY_COLUMNS, behavior: 'smooth' })}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            <button
              type="button"
              aria-label="Cuộn 1 tuần sau"
              onClick={() => scrollRef.current?.scrollBy({ left: dayColWidth * VISIBLE_DAY_COLUMNS, behavior: 'smooth' })}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <CaretRight size={15} weight="bold" />
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <ErrorBanner
          message={error instanceof ApiError ? error.message : 'Không tải được lịch làm việc nhân viên.'}
          onRetry={() => {
            void usersQuery.refetch();
            void shiftsQuery.refetch();
            void listQuery.refetch();
          }}
        />
      )}

      {!loading && !error && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div ref={scrollRef} className="scroll-hover h-full overflow-auto">
            <table className="border-separate border-spacing-0 text-sm" style={{ width: NAME_COL_WIDTH + dayColWidth * days.length }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-100">
                  <th
                    className="sticky left-0 z-30 border-b-2 border-r border-blue-600 bg-slate-100 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-slate-800"
                    style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
                  >
                    Nhân viên
                  </th>
                  {days.map((day) => {
                    const isToday = day === today;
                    return (
                      <th
                        key={day}
                        className="border-b-2 border-r border-slate-300 bg-slate-100 px-2 py-2.5 text-center border-b-blue-600"
                        style={{ width: dayColWidth, minWidth: dayColWidth }}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-[12.5px] font-semibold ${isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                            {WEEKDAY_FULL_LABELS[weekdayLabelIndex(day)]}
                          </span>
                          <span
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                              isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                            }`}
                          >
                            {Number(day.slice(8, 10))}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <td
                      className="sticky left-0 z-10 border-b border-r border-slate-300 bg-white px-4 py-2.5"
                      style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
                    >
                      <div className="flex flex-col">
                        <span className="truncate font-semibold text-slate-900">{person.displayName ?? person.fullName}</span>
                        {person.employeeCode && <span className="text-[11px] font-medium text-slate-400">{person.employeeCode}</span>}
                      </div>
                    </td>
                    {days.map((day) => {
                      const dayItems = itemsByUserDay.get(`${person.id}|${day}`) ?? [];
                      return (
                        <td
                          key={day}
                          className="border-b border-r border-slate-300 px-1.5 py-2 align-top"
                          style={{ width: dayColWidth, minWidth: dayColWidth }}
                        >
                          <div className="flex flex-col gap-1.5">
                            {dayItems.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-1 rounded-md px-2 py-2 text-[11px] font-bold text-white shadow-sm"
                                style={{ background: WORK_SHIFT_COLOR_HEX[item.workShiftColor] }}
                              >
                                <span className="min-w-0 flex-1 truncate">{item.workShiftName}</span>
                                <button
                                  type="button"
                                  aria-label="Xoá ca"
                                  onClick={() => deleteMutation.mutate({ id: item.id, version: item.version })}
                                  className="flex-shrink-0 rounded p-0.5 text-white/75 hover:bg-white/20 hover:text-white"
                                >
                                  <XIcon size={10} weight="bold" />
                                </button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="add"
                              className="w-full justify-center gap-1 px-1.5 py-1.5 text-[11px]"
                              onClick={() => setPickerTarget({ userId: person.id, date: day })}
                            >
                              <Plus size={11} weight="bold" aria-hidden="true" />
                              Thêm ca
                            </Button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pickerTarget && (
        <WorkShiftPickerModal
          subtitle={`Ngày ${formatDDMM(pickerTarget.date)} — ${staff.find((p) => p.id === pickerTarget.userId)?.displayName ?? ''}`}
          workShifts={workShifts}
          saving={createMutation.isPending}
          showLockNotice={false}
          onClose={() => setPickerTarget(null)}
          onSave={(ids) => void handlePickerSave(ids)}
        />
      )}

      {importOpen && (
        <ImportExcelDialog
          defaultMonth={monthAnchor}
          onClose={() => setImportOpen(false)}
          onImported={() => void listQuery.refetch()}
        />
      )}
    </div>
  );
}
