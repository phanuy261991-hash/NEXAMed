/**
 * Thẻ bảo hiểm y tế (S2-04, docs/DECISIONS.md #243) — logic thuần, không phụ thuộc framework/DB.
 *
 * Số thẻ có HAI định dạng cùng tồn tại (chủ dự án chốt 21/10/2026): thẻ MỚI = 12 chữ số, thẻ CŨ =
 * 15 ký tự gồm chữ và số. Hệ thống KHÔNG hỏi lễ tân chọn kiểu — kiểu thẻ là giá trị TÍNH RA từ chính
 * số thẻ (tránh lệch số thẻ ↔ loại thẻ). Sai định dạng chỉ là cảnh báo mềm (kiểu `UNKNOWN`), vẫn lưu
 * được; không đối chiếu ký tự giữa hai định dạng (chưa có nguồn chính thức về quan hệ của chúng).
 *
 * Bản sao tối thiểu của `normalizeInsuranceCardNo`/`detectInsuranceCardKind` có ở web
 * (`apps/web/src/features/insurance-card/insurance-card-view.ts`) vì web chỉ import KIỂU từ
 * `@nexamed/shared` (bản dist là CommonJS) — hai bên dùng chung bộ vector test để không lệch nhau.
 */

export type InsuranceCardKind = 'NEW_12' | 'OLD_15' | 'UNKNOWN';

/** Bỏ mọi khoảng trắng và gạch nối, đổi sang chữ hoa — một thẻ không bị lưu thành nhiều dạng. */
export function normalizeInsuranceCardNo(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Nhận diện kiểu thẻ từ số ĐÃ chuẩn hoá. */
export function detectInsuranceCardKind(normalized: string): InsuranceCardKind {
  if (/^[0-9]{12}$/.test(normalized)) return 'NEW_12';
  if (/^[A-Z0-9]{15}$/.test(normalized)) return 'OLD_15';
  return 'UNKNOWN';
}

export type InsuranceCardValidity = 'VALID' | 'UNKNOWN_EXPIRY' | 'EXPIRED' | 'NOT_STARTED';

export interface InsuranceCardDates {
  /** `YYYY-MM-DD` (ngày lịch Việt Nam) hoặc null. */
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Hiệu lực của thẻ tại ngày `today` (`YYYY-MM-DD`, ngày lịch Việt Nam). Hạn thẻ để trống = "chưa rõ
 * hạn" (thẻ mới có thể không in hạn) — KHÔNG coi là hết hạn. `validTo` tính trọn ngày (còn hiệu lực
 * tới hết ngày đó). `NOT_STARTED`: ngày bắt đầu còn ở tương lai.
 */
export function resolveInsuranceCardValidity(card: InsuranceCardDates, today: string): InsuranceCardValidity {
  if (card.validTo !== null && today > card.validTo) return 'EXPIRED';
  if (card.validFrom !== null && today < card.validFrom) return 'NOT_STARTED';
  if (card.validTo === null) return 'UNKNOWN_EXPIRY';
  return 'VALID';
}

export interface SuggestableInsuranceCard extends InsuranceCardDates {
  id: string;
  /** ISO thời điểm thêm thẻ — "thêm gần nhất" thắng khi cùng mức ưu tiên. */
  createdAt: string;
}

/**
 * Thẻ gợi ý lúc Tiếp nhận: ưu tiên thẻ CÒN HIỆU LỰC (thêm gần nhất), không có thì thẻ CHƯA RÕ HẠN
 * (thêm gần nhất). Thẻ hết hạn / chưa đến ngày hiệu lực KHÔNG được gợi ý. Không có thẻ nào phù hợp
 * thì trả null (lượt khám ghi tự chi trả).
 */
export function pickSuggestedInsuranceCard<T extends SuggestableInsuranceCard>(cards: readonly T[], today: string): T | null {
  const newestFirst = (a: T, b: T): number => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);
  const valid = cards.filter((c) => resolveInsuranceCardValidity(c, today) === 'VALID').sort(newestFirst);
  if (valid[0]) return valid[0];
  const unknown = cards.filter((c) => resolveInsuranceCardValidity(c, today) === 'UNKNOWN_EXPIRY').sort(newestFirst);
  return unknown[0] ?? null;
}
