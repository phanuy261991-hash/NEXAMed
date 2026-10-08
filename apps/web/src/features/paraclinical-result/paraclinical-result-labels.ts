import type { ParaclinicalQueueBucket, ParaclinicalReference, ParaclinicalValueFlag, TechnicalServiceKind } from '@nexamed/shared';

/**
 * Nhãn + phép tính hiển thị của Cận lâm sàng GĐ4 (docs/DECISIONS.md #212). `apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (#073)
 * nên nhãn đặt ở đây với `satisfies Record<…>` để typecheck bắt lệch khoá.
 */

export const QUEUE_BUCKET_ORDER = ['AWAITING_PAYMENT', 'WAITING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED'] as const satisfies readonly ParaclinicalQueueBucket[];

export const QUEUE_BUCKET_LABELS = {
  AWAITING_PAYMENT: 'Chờ thu tiền',
  WAITING: 'Chờ lấy mẫu / gọi vào phòng',
  IN_PROGRESS: 'Đang thực hiện',
  PENDING_APPROVAL: 'Chờ duyệt kết quả',
  COMPLETED: 'Đã trả kết quả',
} as const satisfies Record<ParaclinicalQueueBucket, string>;

/** Nhãn trạng thái ở thanh thông tin của màn nhập kết quả: tone theo token "Tín hiệu Y tế" (ui-guidelines 2.1a). */
export const RESULT_STATUS_META = {
  AWAITING_PAYMENT: { label: 'Chờ thu tiền', tone: 'warning' },
  WAITING: { label: 'Chờ thực hiện', tone: 'warning' },
  IN_PROGRESS: { label: 'Đang thực hiện', tone: 'warning' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'info' },
  COMPLETED: { label: 'Đã trả kết quả', tone: 'success' },
} as const satisfies Record<ParaclinicalQueueBucket, { label: string; tone: 'warning' | 'info' | 'success' }>;

export const SERVICE_KIND_LABELS = {
  LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh',
  FUNCTIONAL: 'Thăm dò chức năng',
} as const satisfies Record<TechnicalServiceKind, string>;

/** Nút hành động chính của dòng hàng đợi theo tab; xét nghiệm là "Lấy mẫu", chẩn đoán hình ảnh/thăm dò là "Gọi vào phòng". */
export function waitingActionLabel(kind: TechnicalServiceKind): string {
  return kind === 'LAB' ? 'Lấy mẫu' : 'Gọi vào phòng';
}

/** "4 phút", "1 giờ 05 phút" — thời gian chờ tính từ mốc `since` đến bây giờ. */
export function formatWaitDuration(sinceIso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${String(rest).padStart(2, '0')} phút`;
}

/** Chờ quá 20 phút thì tô đỏ (đúng mockup: 26/32 phút đỏ, 4/8/11 phút thường). */
export const LONG_WAIT_MINUTES = 20;
export function isLongWait(sinceIso: string, now: number = Date.now()): boolean {
  return (now - new Date(sinceIso).getTime()) / 60_000 > LONG_WAIT_MINUTES;
}

export function genderShort(gender: 'male' | 'female' | 'other' | null): string {
  return gender === 'male' ? 'Nam' : gender === 'female' ? 'Nữ' : gender === 'other' ? 'Khác' : '—';
}

/**
 * Bản PHẢN CHIẾU để hiện badge Cao/Thấp ngay lúc gõ — nguồn sự thật là `evaluateLabValue()` ở `packages/core/src/lab/lab-reference.ts`; API tính lại cờ
 * khi lưu/đọc và bản in dùng cờ của API, nên lệch (nếu có) chỉ ảnh hưởng gợi ý tức thời, không ảnh hưởng dữ liệu đã duyệt.
 */
export function previewFlag(valueType: 'NUMBER' | 'TEXT' | 'CHOICE', raw: string, reference: ParaclinicalReference | null): ParaclinicalValueFlag | null {
  if (reference === null || raw.trim() === '') return null;
  if (valueType === 'NUMBER') {
    const n = Number(raw.trim().replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const { lowValue, highValue } = reference;
    if (lowValue === null && highValue === null) return null;
    if (lowValue !== null && (n < lowValue || (n === lowValue && !reference.lowInclusive))) return 'LOW';
    if (highValue !== null && (n > highValue || (n === highValue && !reference.highInclusive))) return 'HIGH';
    return 'NORMAL';
  }
  if (reference.normalText === null || reference.normalText.trim() === '') return null;
  const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(raw) === norm(reference.normalText) ? 'NORMAL' : 'ABNORMAL';
}

// Đã chuyển sang `shared/format/time.ts` (dùng thêm ở màn sao lưu) — giữ re-export để nơi gọi cũ không phải đổi.
export { formatDateTimeVn } from '../../shared/format/time';
