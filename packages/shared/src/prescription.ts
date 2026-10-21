import { z } from 'zod';
import { prescriptionKindSchema } from './business-code';
import { encounterInsuranceSchema } from './insurance-card';
import { patientAddressSchema } from './patient';

/**
 * Kê đơn (Sprint 4, S4-01→04) — xem .claude/docs/clinical-workflow.md mục "Kê đơn (v1: chỉ in
 * đơn)". Đơn là bản nháp (`signedAt=null`, sửa tự do qua bulk-replace) cho tới khi ký — sau đó bất
 * biến, sửa = đính chính (`amend`, tạo bản ghi mới `supersedesId` trỏ về bản cũ). KHÔNG có
 * "chặn ký cứng" ở v1 (không có nguồn dữ liệu chống chỉ định/liều theo tuổi — PRE-06 hoãn P2 theo
 * `docs/DECISIONS.md` #072) — `warnings` dưới đây chỉ CẢNH BÁO MỀM.
 */
/**
 * "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5, đảo ngược 1 điểm của #190) — đúng
 * 1 trong 2: `drugId` (thuốc thật trong danh mục) HOẶC `freeTextDrugName` (tên tự do, không tính
 * tiền/tồn kho/không phát được qua "Phát thuốc"). CHECK DB (`prescription_item_drug_or_free_text_check`)
 * là nguồn sự thật cuối cùng — validate ở đây chỉ để báo lỗi sớm/rõ ràng hơn cho client.
 */
/**
 * Liều dùng theo buổi Sáng/Trưa/Chiều/Tối (docs/DECISIONS.md #196, mockup đã duyệt) — thay hẳn 2 ô
 * tự do `dose`/`frequency` cũ. `quantity` KHÔNG còn nhận từ client — Service tự tính
 * `computePrescriptionQuantity()` = tổng 4 buổi × `durationDays`, luôn theo đơn vị NHỎ NHẤT của
 * thuốc (không có ô chọn đơn vị — xem `unitCode` ở `prescriptionItemSchema`, chỉ để HIỂN THỊ).
 */
/**
 * Liều MỘT buổi (#241, mockup đã duyệt): bước nhỏ nhất ¼ viên (0, ¼, ½, ¾, 1, 1¼...). Số thực nhưng bội
 * của 0,25 nên biểu diễn chính xác; mọi phép tính tổng đi qua `doseToQuarters` (số nguyên).
 */
export const DOSE_STEP = 0.25;
export const MAX_DOSE_PER_PERIOD = 99.75;
export const doseQuarterSchema = z
  .number()
  .min(0)
  .max(MAX_DOSE_PER_PERIOD)
  .refine((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-9, { message: 'Liều phải là bội của ¼ viên (ví dụ ¼, ½, 1, 1½).' });

export const prescriptionDosePeriodsSchema = z.object({
  doseMorning: doseQuarterSchema,
  doseNoon: doseQuarterSchema,
  doseAfternoon: doseQuarterSchema,
  doseEvening: doseQuarterSchema,
});
export type PrescriptionDosePeriods = z.infer<typeof prescriptionDosePeriodsSchema>;

/** Liều → số nguyên đơn vị ¼ viên (1 viên = 4), để cộng/nhân không sai số số thực. */
export function doseToQuarters(dose: number): number {
  return Math.round(dose * 4);
}

/** Dòng có liều LẺ (không phải số nguyên viên) ở bất kỳ buổi nào — dùng cho cảnh báo thuốc không chia được. */
export function hasFractionalDose(periods: PrescriptionDosePeriods): boolean {
  return [periods.doseMorning, periods.doseNoon, periods.doseAfternoon, periods.doseEvening].some((d) => doseToQuarters(d) % 4 !== 0);
}

const prescriptionItemInputSchema = z
  .object({
    drugId: z.string().uuid().optional(),
    freeTextDrugName: z.string().min(1).max(200).optional(),
    ...prescriptionDosePeriodsSchema.shape,
    durationDays: z.number().int().positive(),
    instruction: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const hasDrug = data.drugId !== undefined;
    const hasFreeText = data.freeTextDrugName !== undefined;
    if (hasDrug === hasFreeText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mỗi dòng thuốc phải có đúng một trong hai: chọn thuốc trong danh mục HOẶC nhập tên thuốc tự do.',
        path: ['drugId'],
      });
    }
    // Liều KHÔNG bắt buộc ở đây: đơn NHÁP được lưu ngay khi vừa thêm thuốc (chưa nhập liều) để cảnh báo trùng hoạt chất hiện liền (#241).
    // Bắt buộc có liều ở lúc KÝ (server) và ĐÍNH CHÍNH (`amendPrescriptionRequestSchema`).
  });

/** Dòng đã có liều dùng ít nhất 1 buổi trong ngày (Sáng/Trưa/Chiều/Tối). */
export function hasAnyDose(periods: PrescriptionDosePeriods): boolean {
  return doseToQuarters(periods.doseMorning) + doseToQuarters(periods.doseNoon) + doseToQuarters(periods.doseAfternoon) + doseToQuarters(periods.doseEvening) > 0;
}

/** Tổng số lượng (đơn vị nhỏ nhất của thuốc) — dùng ở CẢ backend (tính `quantity` lúc lưu) lẫn
 * frontend (xem trước lúc còn đang gõ, trước khi lưu — `apps/web` không được import `@nexamed/core`,
 * #073, nên hàm thuần này đặt ở đây thay vì `packages/core`). */
export function computePrescriptionQuantity(periods: PrescriptionDosePeriods, durationDays: number): number {
  return Math.ceil(computePrescriptionExactQuarters(periods, durationDays) / 4);
}

/** Tổng số theo đơn vị ¼ viên (số nguyên) trước khi làm tròn — `% 4 !== 0` nghĩa là tổng lẻ, đã bị LÀM TRÒN LÊN. */
export function computePrescriptionExactQuarters(periods: PrescriptionDosePeriods, durationDays: number): number {
  const perDay = doseToQuarters(periods.doseMorning) + doseToQuarters(periods.doseNoon) + doseToQuarters(periods.doseAfternoon) + doseToQuarters(periods.doseEvening);
  return perDay * durationDays;
}

/** Liều một buổi dạng đọc được: 0,5 → "½", 1,5 → "1½", 2 → "2", 0,25 → "¼". */
export function formatDoseAmount(dose: number): string {
  const quarters = doseToQuarters(dose);
  const whole = Math.floor(quarters / 4);
  const frac = ['', '¼', '½', '¾'][quarters % 4] ?? '';
  if (whole === 0 && frac === '') return '0';
  return `${whole > 0 ? whole : ''}${frac}`;
}

/** Chuỗi hiển thị "Sáng 1 - Chiều 1 - Tối ½" (bỏ buổi = 0) — dùng cho các nơi CHỈ ĐỌC không có 4 ô
 * riêng để hiện (in đơn, "Phát thuốc", bệnh án PDF). `"—"` khi cả 4 buổi đều 0 (dữ liệu cũ trước
 * #196, đã gộp nội dung gốc vào `instruction` lúc migrate — xem migration
 * `20260929110000_prescription_dose_periods`). */
export function formatDoseSummary(periods: PrescriptionDosePeriods): string {
  const parts: string[] = [];
  if (periods.doseMorning > 0) parts.push(`Sáng ${formatDoseAmount(periods.doseMorning)}`);
  if (periods.doseNoon > 0) parts.push(`Trưa ${formatDoseAmount(periods.doseNoon)}`);
  if (periods.doseAfternoon > 0) parts.push(`Chiều ${formatDoseAmount(periods.doseAfternoon)}`);
  if (periods.doseEvening > 0) parts.push(`Tối ${formatDoseAmount(periods.doseEvening)}`);
  return parts.length > 0 ? parts.join(' - ') : '—';
}

/** `PUT /encounters/:id/prescription-items` — thay thế TOÀN BỘ danh sách dòng thuốc của đơn nháp hiện tại (tạo đơn nháp nếu chưa có). Chỉ dùng được khi đơn CHƯA ký (`PrescriptionAlreadySignedError` nếu đã ký). */
export const savePrescriptionItemsRequestSchema = z.object({
  items: z.array(prescriptionItemInputSchema),
  /** "Lời dặn của bác sĩ" riêng cho đơn thuốc (#241) — in cuối đơn. Bỏ trống/`''` = xoá lời dặn. Không gửi = giữ nguyên. */
  doctorAdvice: z.string().max(2000).optional(),
});
export type SavePrescriptionItemsRequest = z.infer<typeof savePrescriptionItemsRequestSchema>;

export const prescriptionItemSchema = z.object({
  id: z.string().uuid(),
  /** `null` = dòng "kê thuốc tự do, không qua danh mục" — xem `freeTextDrugName`. */
  drugId: z.string().uuid().nullable(),
  /** Tên hiển thị — LUÔN có giá trị dù nguồn là thuốc thật hay tên tự do (server resolve sẵn). */
  drugName: z.string(),
  /** Có giá trị CHỈ khi `drugId=null` (dòng tự do) — dùng để phân biệt hiển thị badge "Ngoài danh mục". */
  freeTextDrugName: z.string().nullable(),
  activeIngredient: z.string().nullable(),
  doseMorning: z.number(),
  doseNoon: z.number(),
  doseAfternoon: z.number(),
  doseEvening: z.number(),
  durationDays: z.number().int(),
  /** Tổng số nguyên theo đơn vị nhỏ nhất, đã LÀM TRÒN LÊN (#241). */
  quantity: z.number().int(),
  /** "Cho phép chia nhỏ" của thuốc (#241) — `true` cho dòng tự do. Web dùng để hiện nhãn "không chia được" + lọc pill liều lẻ. */
  isSplittable: z.boolean(),
  /** Đơn vị nhỏ nhất của thuốc (`drug.baseUnitCode`), resolve qua JOIN — CHỈ hiển thị, không sửa
   * được (docs/DECISIONS.md #196). `null` cho dòng "kê thuốc tự do" hoặc thuốc chưa khai đơn vị cơ sở. */
  unitCode: z.string().nullable(),
  instruction: z.string().nullable(),
  /**
   * Loại đơn Bộ Y tế của dòng này (C/N/H/Y, #242) — CHỈ có giá trị khi phòng khám bật chế độ "Chuẩn Bộ Y tế" (`Prescription.standardMode`), `null` khi tắt hoặc đơn đã ký trước ngày bật.
   * Đơn nháp: tính lại theo ánh xạ hiện tại mỗi lần đọc; đơn đã ký: lấy từ đơn pháp lý đã cấp mã (không đổi theo ánh xạ sau này).
   */
  kind: prescriptionKindSchema.nullable(),
  /** Đơn pháp lý (mã chuẩn) chứa dòng này — `null` khi còn nháp hoặc đơn ký trước ngày bật chế độ chuẩn. */
  documentId: z.string().uuid().nullable(),
});
export type PrescriptionItem = z.infer<typeof prescriptionItemSchema>;

/**
 * Đơn thuốc PHÁP LÝ (docs/DECISIONS.md #242, giai đoạn 2): một lần ký đơn có nhiều loại (C/N/H/Y) tự tách thành từng đơn, MỖI ĐƠN MỘT MÃ chuẩn Bộ Y tế
 * `xxxxxyyyyyyy-z`. Chỉ có khi đơn ký lúc chế độ "Chuẩn Bộ Y tế" đang bật.
 */
export const prescriptionDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: prescriptionKindSchema,
  /** Mã chuẩn 14 ký tự, ví dụ `790010000043-C`. */
  nationalCode: z.string(),
  /** Các dòng thuốc (`PrescriptionItem.id`) thuộc đơn pháp lý này. */
  itemIds: z.array(z.string().uuid()),
});
export type PrescriptionDocument = z.infer<typeof prescriptionDocumentSchema>;

/**
 * `kind`: `duplicate_active_ingredient` (PRE-02, giữa các dòng trong đơn) / `allergy` (PRE-03, đối
 * chiếu danh mục "Dị nguyên" đã gán cho bệnh nhân — không phải `patient.allergyNote` tự do) /
 * `stock_insufficient` (Kho Thuốc GĐ5 — kê vượt tổng tồn kho toàn phòng khám, CHỈ tính khi
 * `pharmacyStockTrackingEnabled=true`). `label` là tên hoạt chất/tên dị nguyên/tên thuốc thiếu tồn;
 * `drugNames` liệt kê thuốc liên quan để bác sĩ đối chiếu.
 */
export const prescriptionWarningSchema = z.object({
  kind: z.enum(['duplicate_active_ingredient', 'allergy', 'stock_insufficient', 'not_splittable']),
  label: z.string(),
  drugNames: z.array(z.string()),
  /** Khoá định danh cảnh báo (`<kind>:<nhãn chuẩn hoá>`) — dùng để "Bỏ qua cảnh báo này" (#228). */
  key: z.string(),
  /** Có giá trị khi bác sĩ đã bỏ qua cảnh báo này TRÊN ĐƠN HIỆN TẠI (chỉ `duplicate_active_ingredient` và `not_splittable` bỏ qua được). */
  acknowledged: z.object({ at: z.string(), byName: z.string(), reason: z.string().nullable() }).nullable(),
});
export type PrescriptionWarning = z.infer<typeof prescriptionWarningSchema>;

/**
 * "Bỏ qua cảnh báo này cho đơn hiện tại" (#228) — CHỈ cảnh báo trùng hoạt chất, CHỈ đơn nháp, lý do không bắt buộc.
 * `acknowledged=false` = bật lại cảnh báo đã bỏ qua. `version` = version của đơn (optimistic locking).
 */
export const acknowledgePrescriptionWarningRequestSchema = z.object({
  key: z.string().min(1).max(200),
  acknowledged: z.boolean(),
  reason: z.string().trim().max(300).optional(),
  version: z.number().int().positive(),
});
export type AcknowledgePrescriptionWarningRequest = z.infer<typeof acknowledgePrescriptionWarningRequestSchema>;

/**
 * Thông tin bệnh nhân IN THÊM trên đơn thuốc (docs/DECISIONS.md #242, mockup 20/10/2026) — chỉ lấy khi bấm In, KHÔNG nằm trong `GET .../consultation` để không giải mã CCCD mỗi lần mở màn khám.
 * `nationalId` đã giải mã; `null` nếu bệnh nhân chưa có CCCD HOẶC người in không có quyền xem hồ sơ bệnh nhân (`patient.read`).
 */
export const prescriptionPrintInfoSchema = z.object({
  patientCode: z.string(),
  nationalId: z.string().nullable(),
  address: patientAddressSchema.nullable(),
  phone: z.string(),
  /** Cân nặng (gram) lấy từ sinh hiệu MỚI NHẤT của lượt khám có ghi cân nặng; `null` = chưa đo. */
  weightGram: z.number().int().nullable(),
  /** Tuổi tính theo tháng tại thời điểm in — web dùng để chỉ in người giám hộ cho trẻ dưới 72 tháng. */
  ageMonths: z.number().int().nonnegative(),
  /** Người thân trong hồ sơ (họ tên + quan hệ); `null` nếu hồ sơ chưa ghi. */
  guardian: z.object({ fullName: z.string(), relationship: z.string().nullable() }).nullable(),
  /** Thẻ BHYT đã chụp lúc tiếp nhận (S2-04, #243) — `null` khi công tắc "Áp dụng BHYT" tắt hoặc người in không có `patient.read`. Web in dòng này khi ô tích của bản mẫu đơn thuốc bật. */
  insurance: encounterInsuranceSchema.nullable(),
});
export type PrescriptionPrintInfo = z.infer<typeof prescriptionPrintInfoSchema>;

export const prescriptionSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  items: z.array(prescriptionItemSchema),
  /** "Lời dặn của bác sĩ" riêng cho đơn này (#241); `null` = chưa nhập → in lời dặn ở tab Điều trị. */
  doctorAdvice: z.string().nullable(),
  /** Tính lại server-side mỗi lần đọc — không lưu DB, chỉ cảnh báo, không chặn ký. */
  warnings: z.array(prescriptionWarningSchema),
  /** "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — sinh lúc KÝ (`null` khi còn nháp). Đính chính
   * (`amend`) GIỮ NGUYÊN mã của bản gốc, không sinh mã mới. */
  prescriptionNo: z.string().nullable(),
  /** Phòng khám đang bật chế độ mã đơn "Chuẩn Bộ Y tế" (#242) — web dùng để hiện chữ cái loại đơn từng dòng, dải "sẽ ký thành N đơn" và nhãn nút ký. */
  standardMode: z.boolean(),
  /** Các đơn pháp lý đã cấp mã chuẩn khi ký (rỗng: còn nháp, hoặc ký trước ngày bật chế độ chuẩn — in như đơn cũ). Thứ tự C, N, H, Y. */
  documents: z.array(prescriptionDocumentSchema),
  signedAt: z.string().nullable(),
  signedBy: z.string().uuid().nullable(),
  printedAt: z.string().nullable(),
  supersedesId: z.string().uuid().nullable(),
  amendmentReason: z.string().nullable(),
  version: z.number().int(),
});
export type Prescription = z.infer<typeof prescriptionSchema>;

/** `null` = lượt khám chưa có đơn thuốc nào (chưa bấm "Kê đơn"). */
export const prescriptionResponseSchema = prescriptionSchema.nullable();
export type PrescriptionResponse = z.infer<typeof prescriptionResponseSchema>;

/** `POST /encounters/:id/prescription/sign` — `version` là version của đơn NHÁP hiện tại. */
export const signPrescriptionRequestSchema = z.object({ version: z.number().int() });
export type SignPrescriptionRequest = z.infer<typeof signPrescriptionRequestSchema>;

/**
 * `POST /encounters/:id/prescription/amend` — đính chính: tạo đơn MỚI (đã ký ngay, cùng hành động
 * xác nhận đính chính) thay thế đơn đã ký hiện tại (`supersedesId` trỏ về, bản cũ soft-delete).
 * `items` là danh sách dòng thuốc ĐẦY ĐỦ của bản đính chính (không diff so với bản cũ). `version`
 * là version của đơn ĐÃ KÝ hiện tại (optimistic lock, chống đính chính trùng khi 2 request gần
 * đồng thời).
 */
export const amendPrescriptionRequestSchema = savePrescriptionItemsRequestSchema
  .extend({
    amendmentReason: z.string().min(1, 'Phải nhập lý do đính chính.'),
    version: z.number().int(),
  })
  .superRefine((data, ctx) => {
    // Đính chính là bản ĐÃ KÝ ngay nên mọi dòng phải có liều (khác lưu nháp).
    data.items.forEach((item, index) => {
      if (!hasAnyDose(item)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Phải nhập liều dùng ít nhất 1 buổi trong ngày (Sáng/Trưa/Chiều/Tối).',
          path: ['items', index, 'doseMorning'],
        });
      }
    });
  });
export type AmendPrescriptionRequest = z.infer<typeof amendPrescriptionRequestSchema>;

/**
 * `GET /encounters/:id/prescription/previous` (docs/DECISIONS.md #196, mockup đã duyệt) — đơn ĐÃ
 * KÝ gần nhất của CÙNG bệnh nhân, ở lượt khám KHÁC lượt khám này. `null` nếu bệnh nhân chưa từng có
 * đơn thuốc nào trước đó. Web dùng để chèn cả cụm vào đơn đang kê ("Sao chép đơn lần trước") — CHƯA
 * lưu ngay, bác sĩ sửa tiếp rồi tự bấm "Lưu đơn nháp", đúng khuôn "Đơn thuốc mẫu".
 */
export const previousPrescriptionResponseSchema = z.object({ items: z.array(prescriptionItemSchema) }).nullable();
export type PreviousPrescriptionResponse = z.infer<typeof previousPrescriptionResponseSchema>;
