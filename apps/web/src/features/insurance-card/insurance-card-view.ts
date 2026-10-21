import { formatDobDisplay } from '../../shared/format/date';

/**
 * Hàm thuần cho thẻ BHYT (S2-04, docs/DECISIONS.md #243). Web chỉ `import type` từ `@nexamed/shared` (bản dist là CommonJS, import giá trị làm trắng trang), nên
 * `normalizeInsuranceCardNo`/`detectInsuranceCardKind` ở đây là BẢN SAO của `packages/core/src/insurance/insurance-card.ts` — hai bên dùng chung bộ vector
 * test (`insurance-card-view.spec.ts` ↔ `insurance-card.spec.ts`), đổi một bên phải đổi bên kia.
 */
export type InsuranceCardKind = 'NEW_12' | 'OLD_15' | 'UNKNOWN';
export type InsuranceCardValidity = 'VALID' | 'UNKNOWN_EXPIRY' | 'EXPIRED' | 'NOT_STARTED';
/**
 * Hiệu lực của thẻ tại ngày `today` (YYYY-MM-DD) — BẢN SAO của `resolveInsuranceCardValidity` ở `packages/core/src/insurance/insurance-card.ts`
 * (cùng bộ vector test), dùng cho thẻ NHÁP ở Tiếp nhận hồ sơ mới (chưa có máy chủ tính).
 */
export function resolveCardValidity(card: { validFrom: string | null; validTo: string | null }, today: string): InsuranceCardValidity {
  if (card.validTo !== null && today > card.validTo) return 'EXPIRED';
  if (card.validFrom !== null && today < card.validFrom) return 'NOT_STARTED';
  if (card.validTo === null) return 'UNKNOWN_EXPIRY';
  return 'VALID';
}

/** Thẻ nhập lúc Tiếp nhận hồ sơ MỚI (chưa có hồ sơ để lưu thẻ): giữ trong form, tạo thẻ ngay sau khi tạo hồ sơ, rồi mới tiếp nhận. Ảnh (nếu có) tải lên sau khi thẻ được tạo. */
export interface InsuranceCardDraft {
  cardNo: string;
  validFrom: string | null;
  validTo: string | null;
  facilityCode: string | null;
  facilityName: string | null;
  benefitRate: number | null;
  frontFile: File | null;
  backFile: File | null;
}

export type InsuranceSelfPayReason = 'DISABLED' | 'NO_CARD' | 'EXPIRED' | 'NOT_STARTED' | 'DECLINED';

/** Bỏ khoảng trắng và gạch nối, đổi sang chữ hoa — một thẻ không bị lưu thành nhiều dạng. */
export function normalizeInsuranceCardNo(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Thẻ MỚI = 12 chữ số, thẻ CŨ = 15 ký tự chữ+số, còn lại không nhận diện được (cảnh báo mềm, vẫn lưu). */
export function detectInsuranceCardKind(normalized: string): InsuranceCardKind {
  if (/^[0-9]{12}$/.test(normalized)) return 'NEW_12';
  if (/^[A-Z0-9]{15}$/.test(normalized)) return 'OLD_15';
  return 'UNKNOWN';
}

export const KIND_LABEL: Record<InsuranceCardKind, string> = {
  NEW_12: 'Thẻ mới · 12 số',
  OLD_15: 'Thẻ cũ · 15 ký tự',
  UNKNOWN: 'Chưa nhận diện được',
};

/** Chip phân loại kiểu thẻ (không phải trạng thái) — nhạt có chủ đích, đúng ui-guidelines 2.1a mục (4) "chip PHÂN LOẠI". */
export const KIND_CHIP_CLASS: Record<InsuranceCardKind, string> = {
  NEW_12: 'border border-blue-200 bg-blue-50 text-blue-700',
  OLD_15: 'border border-slate-300 bg-slate-100 text-slate-700',
  UNKNOWN: 'border border-amber-300 bg-amber-50 text-amber-800',
};

export const VALIDITY_LABEL: Record<InsuranceCardValidity, string> = {
  VALID: 'Còn hiệu lực',
  UNKNOWN_EXPIRY: 'Chưa rõ hạn',
  EXPIRED: 'Hết hạn',
  NOT_STARTED: 'Chưa hiệu lực',
};

/** Tông `StatusBadge` (nền đặc) cho trạng thái hiệu lực của thẻ. */
export const VALIDITY_TONE: Record<InsuranceCardValidity, 'success' | 'warning' | 'neutral'> = {
  VALID: 'success',
  UNKNOWN_EXPIRY: 'warning',
  EXPIRED: 'neutral',
  NOT_STARTED: 'neutral',
};

/** Hiệu lực ghi thành "01/01/2026 – 31/12/2026"; thiếu hạn → "Chưa rõ hạn"; chỉ có hạn → "đến 31/12/2026". */
export function formatValidityRange(validFrom: string | null, validTo: string | null): string {
  if (validFrom && validTo) return `${formatDobDisplay(validFrom)} – ${formatDobDisplay(validTo)}`;
  if (validTo) return `đến ${formatDobDisplay(validTo)}`;
  return 'Chưa rõ hạn';
}

/** Nhãn gọn ở hàng đợi/danh sách: "BHYT 80%", "BHYT" (chưa có mức hưởng), "Tự chi trả". */
export function insuranceBadgeLabel(badge: { selfPay: boolean; benefitRate: number | null }): string {
  if (badge.selfPay) return 'Tự chi trả';
  return badge.benefitRate !== null ? `BHYT ${badge.benefitRate}%` : 'BHYT';
}

export const SELF_PAY_REASON_LABEL: Record<InsuranceSelfPayReason, string> = {
  DISABLED: 'Không áp dụng BHYT',
  NO_CARD: 'Bệnh nhân chưa có thẻ BHYT',
  EXPIRED: 'Thẻ đã hết hạn',
  NOT_STARTED: 'Thẻ chưa đến ngày hiệu lực',
  DECLINED: 'Lễ tân chọn không dùng thẻ',
};

/** Câu cảnh báo mềm khi số thẻ gõ chưa khớp định dạng nào — đưa độ dài hiện có để người gõ biết sai ở đâu. */
export function formatWarningMessage(normalized: string): string {
  const onlyDigits = /^[0-9]+$/.test(normalized);
  return `Số thẻ đang có ${normalized.length} ký tự${onlyDigits ? ' (chỉ gồm chữ số)' : ''}, chưa đúng 12 chữ số (thẻ mới) hoặc 15 ký tự gồm chữ và số (thẻ cũ). Vẫn lưu được nếu bạn chắc số này đúng.`;
}

/** Mức hưởng chọn nhanh (mockup câu b) — ngoài danh sách là "Khác" (nhập số 0–100). */
export const QUICK_BENEFIT_RATES = [100, 95, 80] as const;

/** Phần của thẻ mà khối chọn thẻ ở Tiếp nhận cần — nhận cả `InsuranceCard` đầy đủ. */
export interface ReceptionCardLike {
  id: string;
  validity: InsuranceCardValidity;
  validTo: string | null;
}

/**
 * Cách khối "Thẻ bảo hiểm y tế" ở Tiếp nhận hiện (mockup màn 3, 4 trạng thái): chưa có thẻ nào; chỉ có thẻ KHÔNG dùng được (hết hạn / chưa hiệu lực → lượt khám
 * tự chi trả, kèm dải hổ phách); hoặc có thẻ để chọn (còn hiệu lực + chưa rõ hạn). `choice`: `undefined` = theo gợi ý của máy chủ, `null` = "Không dùng thẻ", uuid = thẻ đó.
 */
export type ReceptionInsuranceView<C extends ReceptionCardLike> =
  | { mode: 'NO_CARDS' }
  | { mode: 'INELIGIBLE'; card: C }
  | { mode: 'PICK'; picks: C[]; selected: C | null; isSuggested: boolean };

export function deriveReceptionInsuranceView<C extends ReceptionCardLike>(cards: C[], suggestedCardId: string | null, choice: string | null | undefined): ReceptionInsuranceView<C> {
  if (cards.length === 0) return { mode: 'NO_CARDS' };
  const picks = cards.filter((c) => c.validity === 'VALID' || c.validity === 'UNKNOWN_EXPIRY');
  if (picks.length === 0) return { mode: 'INELIGIBLE', card: cards.find((c) => c.validity === 'EXPIRED') ?? cards[0]! };
  const effectiveId = choice === undefined ? suggestedCardId : choice;
  const selected = effectiveId === null ? null : (picks.find((c) => c.id === effectiveId) ?? null);
  return { mode: 'PICK', picks, selected, isSuggested: choice === undefined && selected !== null };
}
