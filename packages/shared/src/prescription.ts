import { z } from 'zod';

/**
 * Kê đơn (Sprint 4, S4-01→04) — xem .claude/docs/clinical-workflow.md mục "Kê đơn (v1: chỉ in
 * đơn)". Đơn là bản nháp (`signedAt=null`, sửa tự do qua bulk-replace) cho tới khi ký — sau đó bất
 * biến, sửa = đính chính (`amend`, tạo bản ghi mới `supersedesId` trỏ về bản cũ). KHÔNG có
 * "chặn ký cứng" ở v1 (không có nguồn dữ liệu chống chỉ định/liều theo tuổi — PRE-06 hoãn P2 theo
 * `docs/DECISIONS.md` #072) — `warnings` dưới đây chỉ CẢNH BÁO MỀM.
 */
const prescriptionItemInputSchema = z.object({
  drugId: z.string().uuid(),
  dose: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive(),
  quantity: z.number().int().positive(),
  instruction: z.string().optional(),
});

/** `PUT /encounters/:id/prescription-items` — thay thế TOÀN BỘ danh sách dòng thuốc của đơn nháp hiện tại (tạo đơn nháp nếu chưa có). Chỉ dùng được khi đơn CHƯA ký (`PrescriptionAlreadySignedError` nếu đã ký). */
export const savePrescriptionItemsRequestSchema = z.object({
  items: z.array(prescriptionItemInputSchema),
});
export type SavePrescriptionItemsRequest = z.infer<typeof savePrescriptionItemsRequestSchema>;

export const prescriptionItemSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugName: z.string(),
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
 * chiếu danh mục "Dị nguyên" đã gán cho bệnh nhân — không phải `patient.allergyNote` tự do). `label`
 * là tên hoạt chất hoặc tên dị nguyên; `drugNames` liệt kê thuốc liên quan để bác sĩ đối chiếu.
 */
export const prescriptionWarningSchema = z.object({
  kind: z.enum(['duplicate_active_ingredient', 'allergy']),
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
