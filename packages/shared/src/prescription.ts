import { z } from 'zod';

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
export const prescriptionDosePeriodsSchema = z.object({
  doseMorning: z.number().int().min(0),
  doseNoon: z.number().int().min(0),
  doseAfternoon: z.number().int().min(0),
  doseEvening: z.number().int().min(0),
});
export type PrescriptionDosePeriods = z.infer<typeof prescriptionDosePeriodsSchema>;

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
    if (data.doseMorning + data.doseNoon + data.doseAfternoon + data.doseEvening <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Phải nhập liều dùng ít nhất 1 buổi trong ngày (Sáng/Trưa/Chiều/Tối).',
        path: ['doseMorning'],
      });
    }
  });

/** Tổng số lượng (đơn vị nhỏ nhất của thuốc) — dùng ở CẢ backend (tính `quantity` lúc lưu) lẫn
 * frontend (xem trước lúc còn đang gõ, trước khi lưu — `apps/web` không được import `@nexamed/core`,
 * #073, nên hàm thuần này đặt ở đây thay vì `packages/core`). */
export function computePrescriptionQuantity(periods: PrescriptionDosePeriods, durationDays: number): number {
  return (periods.doseMorning + periods.doseNoon + periods.doseAfternoon + periods.doseEvening) * durationDays;
}

/** Chuỗi hiển thị "Sáng 1 - Chiều 1 - Tối 1" (bỏ buổi = 0) — dùng cho các nơi CHỈ ĐỌC không có 4 ô
 * riêng để hiện (in đơn, "Phát thuốc", bệnh án PDF). `"—"` khi cả 4 buổi đều 0 (dữ liệu cũ trước
 * #196, đã gộp nội dung gốc vào `instruction` lúc migrate — xem migration
 * `20260929110000_prescription_dose_periods`). */
export function formatDoseSummary(periods: PrescriptionDosePeriods): string {
  const parts: string[] = [];
  if (periods.doseMorning > 0) parts.push(`Sáng ${periods.doseMorning}`);
  if (periods.doseNoon > 0) parts.push(`Trưa ${periods.doseNoon}`);
  if (periods.doseAfternoon > 0) parts.push(`Chiều ${periods.doseAfternoon}`);
  if (periods.doseEvening > 0) parts.push(`Tối ${periods.doseEvening}`);
  return parts.length > 0 ? parts.join(' - ') : '—';
}

/** `PUT /encounters/:id/prescription-items` — thay thế TOÀN BỘ danh sách dòng thuốc của đơn nháp hiện tại (tạo đơn nháp nếu chưa có). Chỉ dùng được khi đơn CHƯA ký (`PrescriptionAlreadySignedError` nếu đã ký). */
export const savePrescriptionItemsRequestSchema = z.object({
  items: z.array(prescriptionItemInputSchema),
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
  doseMorning: z.number().int(),
  doseNoon: z.number().int(),
  doseAfternoon: z.number().int(),
  doseEvening: z.number().int(),
  durationDays: z.number().int(),
  quantity: z.number().int(),
  /** Đơn vị nhỏ nhất của thuốc (`drug.baseUnitCode`), resolve qua JOIN — CHỈ hiển thị, không sửa
   * được (docs/DECISIONS.md #196). `null` cho dòng "kê thuốc tự do" hoặc thuốc chưa khai đơn vị cơ sở. */
  unitCode: z.string().nullable(),
  instruction: z.string().nullable(),
});
export type PrescriptionItem = z.infer<typeof prescriptionItemSchema>;

/**
 * `kind`: `duplicate_active_ingredient` (PRE-02, giữa các dòng trong đơn) / `allergy` (PRE-03, đối
 * chiếu danh mục "Dị nguyên" đã gán cho bệnh nhân — không phải `patient.allergyNote` tự do) /
 * `stock_insufficient` (Kho Thuốc GĐ5 — kê vượt tổng tồn kho toàn phòng khám, CHỈ tính khi
 * `pharmacyStockTrackingEnabled=true`). `label` là tên hoạt chất/tên dị nguyên/tên thuốc thiếu tồn;
 * `drugNames` liệt kê thuốc liên quan để bác sĩ đối chiếu.
 */
export const prescriptionWarningSchema = z.object({
  kind: z.enum(['duplicate_active_ingredient', 'allergy', 'stock_insufficient']),
  label: z.string(),
  drugNames: z.array(z.string()),
});
export type PrescriptionWarning = z.infer<typeof prescriptionWarningSchema>;

export const prescriptionSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  items: z.array(prescriptionItemSchema),
  /** Tính lại server-side mỗi lần đọc — không lưu DB, chỉ cảnh báo, không chặn ký. */
  warnings: z.array(prescriptionWarningSchema),
  /** "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — sinh lúc KÝ (`null` khi còn nháp). Đính chính
   * (`amend`) GIỮ NGUYÊN mã của bản gốc, không sinh mã mới. */
  prescriptionNo: z.string().nullable(),
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
export const amendPrescriptionRequestSchema = savePrescriptionItemsRequestSchema.extend({
  amendmentReason: z.string().min(1, 'Phải nhập lý do đính chính.'),
  version: z.number().int(),
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
