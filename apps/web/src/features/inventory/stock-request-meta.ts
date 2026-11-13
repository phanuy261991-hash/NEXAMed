import type { StockRequestDetail, StockRequestLineDisplayStatus, StockRequestPriority, StockRequestStatus } from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/** Nhãn + màu trạng thái "Yêu cầu cấp hàng" (docs/DECISIONS.md #298). Nền đặc theo `StatusBadge`. */
export const REQUEST_STATUS_META: Record<StockRequestStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  // Màu theo mockup màn 2: Đã gửi vàng, Đã tiếp nhận tím, Đang xử lý xanh dương, Đã hoàn thành xanh lá, Từ chối đỏ.
  SUBMITTED: { label: 'Đã gửi', tone: 'warning' },
  ACCEPTED: { label: 'Đã tiếp nhận', tone: 'accent' },
  IN_PROGRESS: { label: 'Đang xử lý', tone: 'info' },
  COMPLETED: { label: 'Đã hoàn thành', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
  WITHDRAWN: { label: 'Đã rút', tone: 'neutral' },
};

/** Thứ tự các ô đếm ở đầu danh sách. */
export const REQUEST_STATUS_ORDER: StockRequestStatus[] = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'];

export const REQUEST_PRIORITY_LABEL: Record<StockRequestPriority, string> = { NORMAL: 'Thường', URGENT: 'Khẩn' };

/** Trạng thái dòng hiển thị cho cả hai bên. */
export const REQUEST_LINE_STATUS_META: Record<StockRequestLineDisplayStatus, { label: string; tone: StatusBadgeTone }> = {
  PENDING: { label: 'Chờ xử lý', tone: 'neutral' },
  WAITING_STOCK: { label: 'Chờ hàng về', tone: 'warning' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  WITHDRAWN: { label: 'Đã rút', tone: 'neutral' },
  WILL_SUPPLY: { label: 'Sẽ cấp', tone: 'info' },
  IN_TRANSIT: { label: 'Đang giao', tone: 'info' },
  VARIANCE_PENDING: { label: 'Nhận thiếu, chờ kho cấp xử lý', tone: 'warning' },
  RETURNING: { label: 'Đang trả về', tone: 'warning' },
  RECEIVED: { label: 'Đã nhận', tone: 'success' },
};

/** Các bước ở đầu phiếu: Đã gửi → Đã tiếp nhận → Đang xử lý → Đã hoàn thành. */
export const REQUEST_STEPS: { key: 'SUBMITTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED'; label: string }[] = [
  { key: 'SUBMITTED', label: 'Đã gửi' },
  { key: 'ACCEPTED', label: 'Đã tiếp nhận' },
  { key: 'IN_PROGRESS', label: 'Đang xử lý' },
  { key: 'COMPLETED', label: 'Đã hoàn thành' },
];

const STEP_RANK: Record<StockRequestStatus, number> = { DRAFT: -1, SUBMITTED: 0, ACCEPTED: 1, IN_PROGRESS: 2, COMPLETED: 3, REJECTED: -1, CANCELLED: -1, WITHDRAWN: -1 };

/** `done` = bước đã qua, `current` = đang ở bước này, `todo` = chưa tới; trạng thái cuối bất thường (từ chối/huỷ/rút) không có bước hiện tại. */
export function stepState(status: StockRequestStatus, step: (typeof REQUEST_STEPS)[number]['key']): 'done' | 'current' | 'todo' {
  const current = STEP_RANK[status];
  const rank = STEP_RANK[step];
  if (current < 0) return status === 'REJECTED' || status === 'CANCELLED' || status === 'WITHDRAWN' ? (rank === 0 ? 'done' : 'todo') : 'todo';
  if (status === 'COMPLETED') return 'done';
  if (rank < current) return 'done';
  return rank === current ? 'current' : 'todo';
}

/** Số dòng còn đang xử lý hoặc chờ trên phiếu — dòng phụ ở bước "Đang xử lý". */
export function progressSummary(detail: Pick<StockRequestDetail, 'lines'>): string {
  const total = detail.lines.length;
  const done = detail.lines.filter((l) => ['RECEIVED', 'REJECTED', 'WITHDRAWN'].includes(l.displayStatus)).length;
  const waiting = detail.lines.filter((l) => l.displayStatus === 'WAITING_STOCK').length;
  return `${done}/${total} dòng đã xong${waiting > 0 ? `, ${waiting} chờ hàng về` : ''}`;
}

/** Ngày yyyy-mm-dd (không múi giờ) sang dd-mm-yyyy. */
export function formatDayVn(day: string | null): string {
  if (!day) return '';
  const [y, m, d] = day.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** Thời điểm ISO sang "dd-mm hh:mm" theo giờ Việt Nam (đủ cho diễn biến). */
/**
 * Tóm tắt những gì bên xin vừa thêm/rút/nhắn SAU lần tiếp nhận gần nhất, cho dải vàng "Bên xin vừa cập nhật phiếu lúc …: thêm 1 mặt hàng (…) và rút 1 dòng (…)" của kho cấp (mockup màn 5).
 * Chỉ lấy tối đa hai cập nhật mới nhất; `null` khi không có cập nhật nào.
 */
export function summarizeRequesterUpdates(events: readonly { eventType: string; message: string | null; detail: string | null; occurredAt: string }[]): { at: string; text: string } | null {
  let lastAccepted = -1;
  events.forEach((e, i) => {
    if (e.eventType === 'accepted') lastAccepted = i;
  });
  const updates = events.slice(lastAccepted + 1).filter((e) => ['lines_added', 'lines_withdrawn', 'note_updated'].includes(e.eventType)).slice(-2);
  if (updates.length === 0) return null;
  const parts = updates.map((e) => {
    const message = (e.message ?? '').replace(/^Bên xin /, '');
    const lower = message.charAt(0).toLowerCase() + message.slice(1);
    return e.detail ? `${lower} (${e.detail})` : lower;
  });
  return { at: updates[updates.length - 1]!.occurredAt, text: parts.join(' và ') };
}

export function formatEventTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatDateTimeLongVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Ma trận "bên xin / kho cấp được làm gì" theo trạng thái — bản sao hiển thị của `requesterActions`/`supplierActions` ở `packages/core` (web không import `@nexamed/core`, #073).
 * Máy chủ luôn kiểm lại thật; ở đây chỉ quyết định nút nào hiện.
 */
export function requesterActionsFor(status: StockRequestStatus) {
  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
      return { cancel: true, edit: true, addLines: true, withdrawLines: false, withdrawOnlyWaiting: false, message: status === 'SUBMITTED' };
    case 'ACCEPTED':
      return { cancel: false, edit: false, addLines: true, withdrawLines: true, withdrawOnlyWaiting: false, message: true };
    case 'IN_PROGRESS':
      return { cancel: false, edit: false, addLines: false, withdrawLines: true, withdrawOnlyWaiting: true, message: true };
    default:
      return { cancel: false, edit: false, addLines: false, withdrawLines: false, withdrawOnlyWaiting: false, message: false };
  }
}

export function supplierActionsFor(status: StockRequestStatus) {
  switch (status) {
    case 'SUBMITTED':
      return { accept: true, rejectAll: true, allocate: false };
    case 'ACCEPTED':
      return { accept: false, rejectAll: true, allocate: true };
    case 'IN_PROGRESS':
      return { accept: false, rejectAll: false, allocate: true };
    default:
      return { accept: false, rejectAll: false, allocate: false };
  }
}
