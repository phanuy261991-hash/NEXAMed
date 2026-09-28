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
const prescriptionItemInputSchema = z
  .object({
    drugId: z.string().uuid().optional(),
    freeTextDrugName: z.string().min(1).max(200).optional(),
    dose: z.string().min(1),
    frequency: z.string().min(1),
    durationDays: z.number().int().positive(),
    quantity: z.number().int().positive(),
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
  });

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
  dose: z.string(),
  frequency: z.string(),
  durationDays: z.number().int(),
  quantity: z.number().int(),
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
