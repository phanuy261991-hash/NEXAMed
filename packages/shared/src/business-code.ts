import { z } from 'zod';

/**
 * "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, chủ dự án yêu cầu trực tiếp 2026-09-03) —
 * cho phép TỪNG TENANT tự cấu hình khuôn mã nghiệp vụ (Nhóm B, khác Nhóm A "mã danh mục" đã rút
 * gọn cố định ở #113). Đặt ở `packages/shared` (không phải `packages/core`) dù có hàm thuần —
 * `apps/web` bị ESLint chặn import `@nexamed/core` (#073) nhưng CẦN gọi `formatBusinessCode` để
 * xem trước mã kế tiếp ngay lúc gõ, không round-trip API — đúng tiền lệ đã có ở đây
 * (`calculateAgeYears`, `labelForEntityType`).
 *
 * Token cố định trong ngoặc vuông (chuỗi tiếng Việt nguyên văn, KHÔNG parse số/tham số động —
 * web chèn qua nút bấm nên không có input tự do sai chính tả). "Số chữ số đệm" tách thành field
 * riêng (`counterDigits`), không nhét vào token, để tránh phải parse số ra khỏi text.
 */
export const BUSINESS_CODE_TOKEN = {
  YEAR_2: '[Năm 2 số]',
  YEAR_4: '[Năm 4 số]',
  MONTH: '[Tháng]',
  DAY: '[Ngày]',
  COUNTER: '[Số đếm]',
  // Mã đơn thuốc theo Bộ Y tế (docs/DECISIONS.md #242) — CHỈ dùng được trong khuôn của loại mã PRESCRIPTION.
  FACILITY_CODE: '[Mã cơ sở KCB]',
  PRESCRIPTION_KIND: '[Loại đơn]',
} as const;

/** Hai token chỉ có nghĩa với mã đơn thuốc — `parseBusinessCodeTemplate(template, codeType)` từ chối ở loại mã khác. */
const PRESCRIPTION_ONLY_TOKENS: string[] = [BUSINESS_CODE_TOKEN.FACILITY_CODE, BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND];

const KNOWN_TOKENS = Object.values(BUSINESS_CODE_TOKEN);

/**
 * Mã đơn thuốc chuẩn Bộ Y tế (`xxxxxyyyyyyy-z`, docs/DECISIONS.md #242): 5 chữ số mã cơ sở KCB + 7 chữ số thập phân bộ đếm chung
 * 4 loại đơn + `-` + loại đơn C/N/H/Y. Chế độ "Chuẩn Bộ Y tế" KHOÁ khuôn mẫu và số chữ số này.
 */
export const PRESCRIPTION_KINDS = ['C', 'N', 'H', 'Y'] as const;
export const prescriptionKindSchema = z.enum(PRESCRIPTION_KINDS);
export type PrescriptionKind = z.infer<typeof prescriptionKindSchema>;
export const PRESCRIPTION_KIND_LABEL: Record<PrescriptionKind, string> = {
  C: 'thông thường',
  N: 'gây nghiện',
  H: 'hướng thần',
  Y: 'y học cổ truyền',
};
export const PRESCRIPTION_STANDARD_TEMPLATE = `${BUSINESS_CODE_TOKEN.FACILITY_CODE}${BUSINESS_CODE_TOKEN.COUNTER}-${BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND}`;
export const PRESCRIPTION_STANDARD_COUNTER_DIGITS = 7;
/** Mã cơ sở khám chữa bệnh: đúng 5 chữ số. */
export const FACILITY_CODE_PATTERN = /^\d{5}$/;
export const facilityCodeSchema = z.string().regex(FACILITY_CODE_PATTERN, 'Mã cơ sở KCB phải gồm đúng 5 chữ số.');
export function isValidFacilityCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && FACILITY_CODE_PATTERN.test(value);
}
/** Khoá bộ đếm riêng của mã đơn chuẩn: `code_sequence.prefix` — chu kỳ (`period_key`) = mã cơ sở KCB nên mỗi cơ sở một bộ đếm, KHÔNG đánh số lại. */
export const PRESCRIPTION_STANDARD_SEQUENCE_PREFIX = 'DTQG';

export const businessCodeModeSchema = z.enum(['CUSTOM', 'STANDARD']);
export type BusinessCodeMode = z.infer<typeof businessCodeModeSchema>;
/** Khớp bất kỳ chuỗi trong ngoặc vuông — dùng để phát hiện token LẠ (không thuộc 5 token đã biết). */
const BRACKET_TOKEN_PATTERN = /\[[^\]]*\]/g;

export const businessCodeTypeSchema = z.enum([
  'PATIENT',
  'DEPARTMENT',
  'EMPLOYEE',
  'APPOINTMENT_BOOKING',
  'ENCOUNTER',
  'INVOICE',
  'CASHIER_SHIFT',
  'CASH_RECEIPT',
  'CASH_PAYMENT',
  'CASH_TRANSFER',
  'WALLET_TOPUP',
  'WALLET_SETTLEMENT',
  'STOCK_RECEIPT',
  'STOCK_ISSUE',
  'PRESCRIPTION',
  'STOCK_COUNT',
  'STOCK_TRANSFER',
  'SUPPLIER_DEBT_ADJUSTMENT',
  'SUPPLIER_DEBT_RECONCILIATION',
  'INVOICE_REFUND',
  'TECH_SERVICE_LAB',
  'TECH_SERVICE_IMAGING',
  'TECH_SERVICE_FUNCTIONAL',
  'LAB_INDICATOR',
  'SERVICE_PACKAGE',
  'PRICE_LIST',
  'CLINICAL_ORDER',
  'SPECIMEN_TUBE',
]);
export type BusinessCodeType = z.infer<typeof businessCodeTypeSchema>;

/**
 * Nhãn tiếng Việt + tiền tố NỘI BỘ mặc định (khoá đếm `code_sequence.prefix`, KHÔNG đổi theo chữ
 * tự do admin gõ trong khuôn mẫu hiển thị — xem comment `BusinessCodeService`). Khuôn MẶC ĐỊNH
 * (`defaultTemplate`) phải tái tạo ĐÚNG hành vi `formatDisplayCode` đang chạy (`<prefix><yy><mm>
 * <seq6>`) để tenant chưa từng cấu hình không thấy khác biệt gì.
 */
/**
 * `defaults` (tuỳ chọn) — chỉ cho loại mã MỚI cần khuôn mặc định KHÁC `<prefix><yy><mm><seq6>` và/hoặc tự đánh số lại theo chu kỳ ngay cả khi tenant chưa lưu khuôn riêng
 * (loại mã cũ KHÔNG khai, để giữ tương thích ngược tuyệt đối — xem `BusinessCodeService.generate`).
 */
export interface BusinessCodeTypeInfo {
  label: string;
  internalPrefix: string;
  defaults?: { template: string; counterDigits: number; resetsByDefault: boolean };
}

export const BUSINESS_CODE_TYPE_REGISTRY: Record<BusinessCodeType, BusinessCodeTypeInfo> = {
  PATIENT: { label: 'Mã bệnh nhân', internalPrefix: 'BN' },
  DEPARTMENT: { label: 'Mã Khoa/Phòng', internalPrefix: 'KP' },
  EMPLOYEE: { label: 'Mã nhân viên', internalPrefix: 'NV' },
  APPOINTMENT_BOOKING: { label: 'Mã đặt lịch', internalPrefix: 'LH' },
  ENCOUNTER: { label: 'Mã lượt khám', internalPrefix: 'LK' },
  INVOICE: { label: 'Mã phiếu thu', internalPrefix: 'PT' },
  CASHIER_SHIFT: { label: 'Mã phiếu chốt ca', internalPrefix: 'PCC' },
  // "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — không trùng "PT" (phiếu thu viện phí)/"PCC" (phiếu
  // chốt ca) đã dùng.
  CASH_RECEIPT: { label: 'Mã phiếu thu quỹ', internalPrefix: 'PTQ' },
  CASH_PAYMENT: { label: 'Mã phiếu chi quỹ', internalPrefix: 'PCQ' },
  // "Sổ quỹ & Thu chi" GĐ2 — phiếu Chuyển quỹ (di chuyển tiền giữa 2 quỹ nội bộ, không phải Thu/
  // Chi thật). Không trùng PTQ/PCQ đã có.
  CASH_TRANSFER: { label: 'Mã phiếu chuyển quỹ', internalPrefix: 'PCK' },
  // "Ví tạm ứng" — tách riêng khỏi CASH_RECEIPT/CASH_PAYMENT để mã phiếu tự phân biệt "tiền của
  // bệnh nhân gửi tạm" với phiếu thu/chi quỹ thông thường, không trùng PTQ/PCQ/PCK đã có.
  WALLET_TOPUP: { label: 'Mã phiếu thu tạm ứng', internalPrefix: 'PTU' },
  WALLET_SETTLEMENT: { label: 'Mã phiếu hoàn ứng', internalPrefix: 'PCU' },
  // Kho Thuốc GĐ2 — "Phiếu nhập kho", không trùng tiền tố nào đã dùng ở trên.
  STOCK_RECEIPT: { label: 'Mã phiếu nhập kho', internalPrefix: 'PNK' },
  // Kho Thuốc GĐ3 — "Phiếu xuất kho" (phát thuốc theo đơn), không trùng PNK đã dùng ở trên.
  STOCK_ISSUE: { label: 'Mã phiếu xuất kho', internalPrefix: 'PXK' },
  // "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — không trùng tiền tố nào đã dùng ở trên. Đơn
  // đính chính (amend) GIỮ NGUYÊN mã gốc (không sinh mã mới), xem `EncounterService.amendPrescription()`.
  PRESCRIPTION: { label: 'Mã đơn thuốc', internalPrefix: 'DT' },
  // Kho Thuốc GĐ4 — "Phiếu kiểm kê kho" (docs/DECISIONS.md #170), không trùng tiền tố nào đã dùng ở trên.
  STOCK_COUNT: { label: 'Mã phiếu kiểm kê kho', internalPrefix: 'PKK' },
  // Kho Thuốc GĐ4 — "Phiếu điều chuyển kho" (docs/DECISIONS.md #170), không trùng "PCK" (đã dùng cho
  // CASH_TRANSFER) hay tiền tố nào khác đã dùng ở trên.
  STOCK_TRANSFER: { label: 'Mã phiếu điều chuyển kho', internalPrefix: 'PDC' },
  // "Công nợ nhà cung cấp" Phần D (docs/DECISIONS.md #180/#182) — "Phiếu điều chỉnh công nợ"/"Đề
  // nghị huỷ", không trùng tiền tố nào đã dùng ở trên.
  SUPPLIER_DEBT_ADJUSTMENT: { label: 'Mã phiếu điều chỉnh công nợ', internalPrefix: 'PDN' },
  // "Công nợ nhà cung cấp" Phần E (docs/DECISIONS.md #182 câu 3) — "Biên bản đối chiếu", không trùng
  // tiền tố nào đã dùng ở trên.
  SUPPLIER_DEBT_RECONCILIATION: { label: 'Mã biên bản đối chiếu công nợ', internalPrefix: 'BBD' },
  // Hoàn tiền MỘT PHẦN theo dòng thuốc (docs/DECISIONS.md #203) — "Phiếu hoàn tiền", không trùng tiền
  // tố nào đã dùng ở trên.
  INVOICE_REFUND: { label: 'Mã phiếu hoàn tiền', internalPrefix: 'PHT' },
  // Cận lâm sàng GĐ1 (docs/DECISIONS.md #212) — mã dịch vụ kỹ thuật theo loại (XN/CD/TD) và chỉ số xét
  // nghiệm (CS). Không trùng tiền tố nào đã dùng ở trên.
  TECH_SERVICE_LAB: { label: 'Mã dịch vụ xét nghiệm', internalPrefix: 'XN' },
  TECH_SERVICE_IMAGING: { label: 'Mã dịch vụ chẩn đoán hình ảnh', internalPrefix: 'CD' },
  TECH_SERVICE_FUNCTIONAL: { label: 'Mã dịch vụ thăm dò chức năng', internalPrefix: 'TD' },
  LAB_INDICATOR: { label: 'Mã chỉ số xét nghiệm', internalPrefix: 'CS' },
  // Cận lâm sàng GĐ2 (docs/DECISIONS.md #212) — gói dịch vụ (GOI) và bảng giá có thời hạn (BG). BG0000 dành riêng
  // cho "Bảng giá chung" (không lưu bản ghi, chỉ hiện ở danh sách) nên bộ đếm không bao giờ sinh ra mã 0.
  SERVICE_PACKAGE: { label: 'Mã gói dịch vụ', internalPrefix: 'GOI' },
  PRICE_LIST: { label: 'Mã bảng giá', internalPrefix: 'BG' },
  // Cận lâm sàng GĐ3 (#212) — phiếu chỉ định cận lâm sàng (CLS), in trên phiếu chỉ định + hàng đợi cận lâm sàng.
  CLINICAL_ORDER: { label: 'Mã phiếu chỉ định cận lâm sàng', internalPrefix: 'CLS' },
  // Lấy mẫu xét nghiệm có tem mã vạch (docs/DECISIONS.md #220) — mã ống mẫu (SID), in thành mã vạch Code 128 trên tem ống nghiệm. Mặc định TOÀN SỐ (yyMMdd + 4 số, đánh số lại mỗi ngày)
  // để vạch dày, quét chắc trên tem 35 mm; tenant tự đổi khuôn ở "Cấu hình mẫu mã phát sinh".
  SPECIMEN_TUBE: {
    label: 'Mã ống mẫu xét nghiệm',
    internalPrefix: 'ONG',
    defaults: { template: '[Năm 2 số][Tháng][Ngày][Số đếm]', counterDigits: 4, resetsByDefault: true },
  },
};

export const DEFAULT_BUSINESS_CODE_COUNTER_DIGITS = 6;
export const DEFAULT_BUSINESS_CODE_STARTING_VALUE = 1;

function defaultTemplateFor(codeType: BusinessCodeType): string {
  const custom = BUSINESS_CODE_TYPE_REGISTRY[codeType].defaults;
  if (custom) return custom.template;
  return `${BUSINESS_CODE_TYPE_REGISTRY[codeType].internalPrefix}${BUSINESS_CODE_TOKEN.YEAR_2}${BUSINESS_CODE_TOKEN.MONTH}${BUSINESS_CODE_TOKEN.COUNTER}`;
}
export const DEFAULT_BUSINESS_CODE_TEMPLATE: Record<BusinessCodeType, string> = Object.fromEntries(
  businessCodeTypeSchema.options.map((t) => [t, defaultTemplateFor(t)]),
) as Record<BusinessCodeType, string>;

/** Số chữ số đệm mặc định của loại mã (khuôn mặc định riêng nếu có, không thì 6). */
export function defaultBusinessCodeCounterDigits(codeType: BusinessCodeType): number {
  return BUSINESS_CODE_TYPE_REGISTRY[codeType].defaults?.counterDigits ?? DEFAULT_BUSINESS_CODE_COUNTER_DIGITS;
}

/** Loại mã tự đánh số lại theo chu kỳ trong khuôn ngay cả khi tenant CHƯA lưu khuôn riêng (chỉ loại mã mới khai `defaults.resetsByDefault`). */
export function businessCodeResetsByDefault(codeType: BusinessCodeType): boolean {
  return BUSINESS_CODE_TYPE_REGISTRY[codeType].defaults?.resetsByDefault ?? false;
}

export interface ParsedBusinessCodeTemplate {
  hasYear: boolean;
  hasMonth: boolean;
  hasDay: boolean;
}

export type ParseBusinessCodeTemplateResult =
  | { ok: true; parsed: ParsedBusinessCodeTemplate }
  | { ok: false; error: string };

/**
 * Validate khuôn mẫu: đúng 1 lần `[Số đếm]` (bắt buộc — không có thì không đảm bảo mã không
 * trùng), mỗi token khác tối đa 1 lần, không có `[...]` nào lạ ngoài 5 token đã biết.
 */
export function parseBusinessCodeTemplate(template: string, codeType?: BusinessCodeType): ParseBusinessCodeTemplateResult {
  const brackets = template.match(BRACKET_TOKEN_PATTERN) ?? [];
  const unknown = brackets.filter((b) => !KNOWN_TOKENS.includes(b as (typeof KNOWN_TOKENS)[number]));
  if (unknown.length > 0) {
    return { ok: false, error: `Token không hợp lệ: ${unknown.join(', ')}` };
  }
  if (codeType !== undefined && codeType !== 'PRESCRIPTION') {
    const misplaced = brackets.filter((b) => PRESCRIPTION_ONLY_TOKENS.includes(b));
    if (misplaced.length > 0) {
      return { ok: false, error: `Token ${misplaced[0]} chỉ dùng được cho mã đơn thuốc.` };
    }
  }

  const countOf = (token: string) => brackets.filter((b) => b === token).length;
  const counterCount = countOf(BUSINESS_CODE_TOKEN.COUNTER);
  if (counterCount === 0) {
    return { ok: false, error: `Khuôn mẫu phải có đúng 1 token ${BUSINESS_CODE_TOKEN.COUNTER}` };
  }
  if (counterCount > 1) {
    return { ok: false, error: `Token ${BUSINESS_CODE_TOKEN.COUNTER} chỉ được dùng 1 lần` };
  }
  for (const token of [
    BUSINESS_CODE_TOKEN.YEAR_2,
    BUSINESS_CODE_TOKEN.YEAR_4,
    BUSINESS_CODE_TOKEN.MONTH,
    BUSINESS_CODE_TOKEN.DAY,
    BUSINESS_CODE_TOKEN.FACILITY_CODE,
    BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND,
  ]) {
    if (countOf(token) > 1) {
      return { ok: false, error: `Token ${token} chỉ được dùng tối đa 1 lần` };
    }
  }

  return {
    ok: true,
    parsed: {
      hasYear: countOf(BUSINESS_CODE_TOKEN.YEAR_2) > 0 || countOf(BUSINESS_CODE_TOKEN.YEAR_4) > 0,
      hasMonth: countOf(BUSINESS_CODE_TOKEN.MONTH) > 0,
      hasDay: countOf(BUSINESS_CODE_TOKEN.DAY) > 0,
    },
  };
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * Chu kỳ reset bộ đếm = granularity MỊN NHẤT xuất hiện trong khuôn (chốt qua AskUserQuestion,
 * docs/DECISIONS.md #114): có `[Ngày]` → reset theo ngày; có `[Tháng]` (không ngày) → theo tháng;
 * có năm (không tháng/ngày) → theo năm; không token thời gian nào → '' (chạy liên tục, đúng hành
 * vi `code_sequence` hiện tại — KHÔNG bao giờ reset).
 */
export function computeBusinessCodePeriodKey(parsed: ParsedBusinessCodeTemplate, date: DateParts): string {
  const yyyy = String(date.year).padStart(4, '0');
  if (parsed.hasDay) {
    return `${yyyy}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
  }
  if (parsed.hasMonth) {
    return `${yyyy}${String(date.month).padStart(2, '0')}`;
  }
  if (parsed.hasYear) {
    return yyyy;
  }
  return '';
}

/** Giá trị cho hai token riêng của mã đơn thuốc; thiếu thì token được giữ nguyên (nơi gọi tự đảm bảo truyền đủ khi khuôn có token đó). */
export interface BusinessCodeExtras {
  facilityCode?: string;
  prescriptionKind?: PrescriptionKind;
}

/** Ghép khuôn mẫu thành mã thật — `seq` do backend cấp atomic; ở web chỉ dùng để XEM TRƯỚC. */
export function formatBusinessCode(template: string, counterDigits: number, date: DateParts, seq: number | bigint, extras: BusinessCodeExtras = {}): string {
  const yy = String(date.year % 100).padStart(2, '0');
  const yyyy = String(date.year).padStart(4, '0');
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  const seqStr = seq.toString().padStart(counterDigits, '0');

  return template
    .split(BUSINESS_CODE_TOKEN.YEAR_2)
    .join(yy)
    .split(BUSINESS_CODE_TOKEN.YEAR_4)
    .join(yyyy)
    .split(BUSINESS_CODE_TOKEN.MONTH)
    .join(mm)
    .split(BUSINESS_CODE_TOKEN.DAY)
    .join(dd)
    .split(BUSINESS_CODE_TOKEN.FACILITY_CODE)
    .join(extras.facilityCode ?? BUSINESS_CODE_TOKEN.FACILITY_CODE)
    .split(BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND)
    .join(extras.prescriptionKind ?? BUSINESS_CODE_TOKEN.PRESCRIPTION_KIND)
    .split(BUSINESS_CODE_TOKEN.COUNTER)
    .join(seqStr);
}

/** Mã đơn thuốc chuẩn Bộ Y tế, ghép trực tiếp (không đi qua khuôn tuỳ chỉnh): `<5 số KCB><7 số>-<C|N|H|Y>`. */
export function formatPrescriptionNationalCode(facilityCode: string, seq: number | bigint, kind: PrescriptionKind): string {
  return formatBusinessCode(PRESCRIPTION_STANDARD_TEMPLATE, PRESCRIPTION_STANDARD_COUNTER_DIGITS, { year: 2000, month: 1, day: 1 }, seq, {
    facilityCode,
    prescriptionKind: kind,
  });
}

export const businessCodeTemplateItemSchema = z.object({
  codeType: businessCodeTypeSchema,
  label: z.string(),
  prefix: z.string(),
  template: z.string(),
  counterDigits: z.number().int().min(1).max(9),
  startingValue: z.number().int().positive(),
  /** `true` = loại mã này đã phát sinh ít nhất 1 mã — `startingValue` không sửa được nữa. */
  locked: z.boolean(),
  /** Mã kế tiếp minh hoạ (tính từ `currentValue` thật hiện có, KHÔNG cấp số/đụng DB). */
  exampleNextCode: z.string(),
  /** `STANDARD` = "Chuẩn Bộ Y tế" (chỉ loại mã PRESCRIPTION, #242): khuôn + số chữ số bị khoá, không đánh số lại. Loại mã khác luôn `CUSTOM`. */
  mode: businessCodeModeSchema,
  /** Loại mã này có chế độ "Chuẩn Bộ Y tế" không (hiện chỉ PRESCRIPTION). */
  supportsStandardMode: z.boolean(),
});
export type BusinessCodeTemplateItem = z.infer<typeof businessCodeTemplateItemSchema>;

export const listBusinessCodeTemplatesResponseSchema = z.object({
  items: z.array(businessCodeTemplateItemSchema),
});
export type ListBusinessCodeTemplatesResponse = z.infer<typeof listBusinessCodeTemplatesResponseSchema>;

export const updateBusinessCodeTemplateRequestSchema = z.object({
  template: z.string().min(1),
  counterDigits: z.number().int().min(1).max(9),
  /** Chỉ chấp nhận khi loại mã CHƯA `locked` — server 409 nếu gửi kèm lúc đã khoá. */
  startingValue: z.number().int().positive().optional(),
  /** Bỏ trống = giữ chế độ hiện tại. `STANDARD` chỉ hợp lệ với PRESCRIPTION; server tự đặt khuôn + số chữ số chuẩn và bỏ qua `template`/`counterDigits` gửi kèm. */
  mode: businessCodeModeSchema.optional(),
});
export type UpdateBusinessCodeTemplateRequest = z.infer<typeof updateBusinessCodeTemplateRequestSchema>;

/** Một chi nhánh trong kiểm tra "sẵn sàng bật chế độ Chuẩn Bộ Y tế" của mã đơn thuốc. */
export const prescriptionStandardReadinessBranchSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  /** Mã KCB riêng của chi nhánh (null = chưa nhập, dùng mã công ty nếu có). */
  facilityCode: z.string().nullable(),
  /** Mã KCB thực dùng: của chi nhánh nếu hợp lệ, không thì của công ty nếu hợp lệ, không thì null. */
  effectiveFacilityCode: z.string().nullable(),
  source: z.enum(['BRANCH', 'COMPANY', 'NONE']),
  ready: z.boolean(),
  /** Mã kế tiếp minh hoạ cho đơn thường (loại C) của cơ sở này; null khi chưa sẵn sàng. */
  exampleNextCode: z.string().nullable(),
});
export type PrescriptionStandardReadinessBranch = z.infer<typeof prescriptionStandardReadinessBranchSchema>;

export const prescriptionStandardReadinessResponseSchema = z.object({
  /** Mọi chi nhánh đang hoạt động đều sẵn sàng. */
  ready: z.boolean(),
  /** Mã KCB cấp công ty (`Thông tin phòng khám`), null nếu chưa nhập. */
  companyFacilityCode: z.string().nullable(),
  /** Công ty có từ 2 chi nhánh hoạt động không (giao diện chỉ hiện bảng chi nhánh khi true). */
  multiBranch: z.boolean(),
  branches: z.array(prescriptionStandardReadinessBranchSchema),
});
export type PrescriptionStandardReadinessResponse = z.infer<typeof prescriptionStandardReadinessResponseSchema>;
