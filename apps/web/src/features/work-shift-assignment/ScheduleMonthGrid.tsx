import type { WorkShiftAssignmentItem } from '@nexamed/shared';

const WEEKDAY_HEADS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** Màu chip ca theo trạng thái bảng tháng (đúng mockup #225): Nháp xanh dương, Chờ duyệt hổ phách, Đã duyệt xanh lá. */
export const SCHEDULE_CHIP_TONE = {
  DRAFT: 'bg-blue-50 text-blue-800 ring-blue-200',
  SUBMITTED: 'bg-amber-50 text-amber-800 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
} as const;

/**
 * Lưới tháng CHỈ ĐỌC (T2 đầu tuần) hiện chip tên ca từng ngày — dùng ở hộp "Xem lịch" của quản lý khi duyệt
 * đăng ký ca ("Duyệt đăng ký ca theo tháng", #225). Chip tô màu theo trạng thái bảng tháng.
 */
export function ScheduleMonthGrid({
  month,
  items,
  tone,
}: {
  month: string;
  items: Pick<WorkShiftAssignmentItem, 'workDate' | 'workShiftName'>[];
  tone: keyof typeof SCHEDULE_CHIP_TONE;
}) {
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, 1)).getUTCDay();
  const leading = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const byDay = new Map<number, string[]>();
  for (const it of items) {
    const day = Number(it.workDate.slice(8, 10));
    byDay.set(day, [...(byDay.get(day) ?? []), it.workShiftName]);
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_HEADS.map((d, i) => (
            <div key={d} className={`py-1 text-center text-[11px] font-bold uppercase tracking-wide ${i >= 5 ? 'text-slate-300' : 'text-slate-400'}`}>
              {d}
            </div>
          ))}
          {Array.from({ length: leading }).map((_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const shifts = byDay.get(day) ?? [];
            return (
              <div key={day} className="flex min-h-[64px] flex-col items-start gap-1 rounded-lg border border-slate-200 bg-white p-1.5">
                <span className={`text-[12px] font-bold ${shifts.length > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{day}</span>
                <span className="flex flex-wrap gap-1">
                  {shifts.map((name, idx) => (
                    <span key={idx} className={`max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${SCHEDULE_CHIP_TONE[tone]}`} title={name}>
                      {name}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
