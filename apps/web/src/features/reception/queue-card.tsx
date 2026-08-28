import { CalendarCheck, Clock, PlusCircle, Play, Star, Warning, XCircle, type Icon } from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';

/**
 * Thành phần dùng chung cho MỌI nơi hiển thị thẻ "khách đang chờ" theo mô hình Hàng đợi ảo
 * (`docs/DECISIONS.md` #064) — trích xuất từ `ReceptionDoctorQueuePage.tsx` vì nút "Hàng chờ" ở
 * Topbar (`DoctorQueueButton.tsx`) là nơi dùng thứ hai, đúng quy tắc CLAUDE.md "trùng lặp lần thứ
 * hai mới trích xuất".
 */

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

export function waitMinutes(checkedInAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(checkedInAt).getTime()) / 60_000));
}

/**
 * Tìm theo tên hoặc mã bệnh nhân, KHÔNG bỏ dấu tiếng Việt (khác PAT-02) — lọc thuần phía client
 * trên dữ liệu đã tải sẵn trong 1 cột/nhóm, không đáng đổi lấy rủi ro vỡ Rollup production build
 * đã gặp khi thử import `stripVietnameseDiacritics` từ `@nexamed/core` (xem comment gốc ở
 * `ReceptionDoctorQueuePage.tsx` lúc hàm này còn khai báo tại chỗ).
 */
export function matchesQueueSearch(item: { fullName: string; patientCode: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return item.fullName.toLowerCase().includes(q) || item.patientCode.toLowerCase().includes(q);
}

/**
 * Thanh tiêu đề nhóm nền màu đặc — mỗi nhóm một màu riêng (xanh dương = của tôi, tím = hàng chờ
 * chung) để phân biệt ngay từ xa, không cần đọc chữ (chốt 2026-08-21).
 */
const GROUP_LABEL_STYLES: Record<'personal' | 'pool' | 'progress', string> = {
  personal: 'bg-blue-600',
  pool: 'bg-violet-600',
  // Cùng tông `bg-amber-500 text-white` đã dùng cho badge "Đang khám"/thời gian trôi ở
  // `ReceptionDoctorQueuePage.tsx` — không phát minh cặp màu mới.
  progress: 'bg-amber-500',
};

export function GroupLabel({
  icon: IconComponent,
  variant,
  count,
  children,
}: {
  icon: Icon;
  variant: 'personal' | 'pool' | 'progress';
  count: number;
  children: React.ReactNode;
}) {
  const styles = GROUP_LABEL_STYLES[variant];
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm ${styles}`}>
      <IconComponent size={13} weight="bold" aria-hidden="true" />
      {children}
      <span className="ml-auto rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">{count}</span>
    </div>
  );
}

export function ColumnEmpty({ icon: IconComponent, text }: { icon: Icon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-slate-400">
      <IconComponent size={26} weight="light" className="opacity-60" aria-hidden="true" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

/**
 * Thẻ "khách đang chờ" theo đúng mockup đã duyệt (`docs/design/doctor-queue-virtual-queue-mockup.html`
 * `.card`) — `overdue` áp dụng cho MỌI thẻ (không phân biệt của tôi/hàng chờ chung), ưu tiên hiển
 * thị badge "Chờ lâu" (khẩn cấp hơn) khi vừa ưu tiên vừa chờ lâu cùng lúc. `onCancel` TUỲ CHỌN —
 * nơi dùng thứ hai (panel gọn trong `DoctorQueueButton.tsx`) không có hành động "Hủy khám" tại
 * chỗ (đã có sẵn ở trang Hàng đợi khám đầy đủ), chỉ tập trung vào chuyển đổi khám.
 */
export function WaitingCard({
  item,
  pool,
  loading,
  warningMinutes,
  onStart,
  onCancel,
}: {
  item: ReceptionListItem;
  pool: boolean;
  loading: boolean;
  warningMinutes: number;
  onStart: () => void;
  onCancel?: () => void;
}) {
  const minutes = waitMinutes(item.checkedInAt);
  const overdue = minutes >= warningMinutes;
  const criticalState = overdue ? 'overdue' : item.isPriority ? 'priority' : null;

  const borderLeftClass =
    criticalState === 'overdue' ? 'border-l-rose-600' : criticalState === 'priority' ? 'border-l-amber-500' : pool ? 'border-l-blue-400' : 'border-l-slate-300';
  const bgClass = criticalState === 'overdue' ? 'bg-rose-50/60' : criticalState === 'priority' ? 'bg-amber-50/50' : 'bg-white';

  // Nét đứt chỉ phân biệt "hàng chờ chung" khi thẻ CHƯA chờ lâu — thẻ chờ lâu ưu tiên rõ ràng/khẩn
  // cấp bằng nét liền, phản hồi chủ dự án "nét đứt + đỏ nhìn thô" (2026-08-28).
  const dashed = pool && criticalState !== 'overdue';

  return (
    <article
      className={`rounded-lg border-2 border-l-4 p-3 shadow-sm ${borderLeftClass} ${bgClass} border-slate-200 ${
        dashed ? 'border-dashed' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate">
          <span className="text-[15px] font-bold text-slate-900">{item.fullName}</span>
          <span className="ml-1.5 text-[11px] font-bold text-slate-500">{item.patientCode}</span>
        </div>
        {criticalState === 'overdue' && (
          <span className="badge-urgent-pulse flex flex-shrink-0 items-center gap-1 rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white">
            <Warning size={12} weight="fill" aria-hidden="true" />
            Chờ lâu
          </span>
        )}
        {criticalState === 'priority' && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10.5px] font-bold text-white">
            <Star size={12} weight="fill" aria-hidden="true" />
            Ưu tiên
          </span>
        )}
      </div>
      {item.chiefComplaint && (
        <p className="mt-1 truncate text-[12.5px] text-slate-700">
          <span className="font-bold text-slate-900">Lý do: </span>
          {item.chiefComplaint}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
        {item.appointmentId && (
          <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-700">
            <CalendarCheck size={11} weight="bold" aria-hidden="true" />
            Đặt lịch trước
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 font-bold ${pool ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
          {pool ? 'Chưa gán bác sĩ' : 'Của tôi'}
        </span>
        <span className="flex items-center gap-1 font-semibold text-slate-600">
          <Clock size={11} weight="bold" aria-hidden="true" />
          Tiếp nhận {formatTime(item.checkedInAt)}
        </span>
        <span className={`font-semibold ${overdue ? 'text-rose-600' : 'text-slate-700'}`}>Chờ {minutes} phút</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-1.5">
        <Button type="button" variant={pool ? 'secondary' : 'primary'} className="px-3" loading={loading} onClick={onStart}>
          {pool ? <PlusCircle size={13} weight="bold" aria-hidden="true" /> : <Play size={13} weight="bold" aria-hidden="true" />}
          {pool ? 'Gọi khám' : 'Bắt đầu khám'}
        </Button>
        {onCancel && (
          <Button type="button" variant="danger" className="flex-shrink-0 px-2.5" onClick={onCancel} aria-label="Hủy khám" title="Hủy khám">
            <XCircle size={15} weight="bold" aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  );
}