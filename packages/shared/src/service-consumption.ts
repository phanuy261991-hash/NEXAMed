import { z } from 'zod';
import { drugItemTypeSchema } from './drug';

/**
 * "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297, giai đoạn 4): ĐỊNH MỨC vật tư/thuốc tiêu hao của một dịch vụ + GHI tiêu hao thật cho từng lượt dịch vụ đã làm.
 * Định mức là dữ liệu CHUNG cả công ty; phiếu tiêu hao theo chi nhánh (kho/lượt khám). Không thu thêm tiền khách, không vào lãi gộp.
 */

/** Dịch vụ có định mức: dịch vụ khám (mã danh mục) hoặc dịch vụ kỹ thuật (id). */
export const serviceConsumptionKindSchema = z.enum(['EXAM_TYPE', 'TECHNICAL_SERVICE']);
export type ServiceConsumptionKind = z.infer<typeof serviceConsumptionKindSchema>;

/** Một lượt dịch vụ cụ thể của lượt khám: dòng chỉ định cận lâm sàng hoặc dịch vụ khám đã chọn ở Tiếp nhận. */
export const consumptionTargetKindSchema = z.enum(['CLINICAL_ORDER_ITEM', 'ENCOUNTER_SERVICE_ITEM']);
export type ConsumptionTargetKind = z.infer<typeof consumptionTargetKindSchema>;

export const MAX_CONSUMPTION_LINES = 50;
const quantitySchema = z.number().int().positive('Số lượng phải lớn hơn 0.').max(1_000_000);

function uniqueDrugs(lines: { drugId: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.drugId)) ctx.addIssue({ code: 'custom', message: 'Mỗi vật tư/thuốc chỉ xuất hiện một dòng.', path: [i, 'drugId'] });
    seen.add(l.drugId);
  });
}

// ---------------- Định mức ----------------
export const serviceNormQuerySchema = z.object({
  kind: serviceConsumptionKindSchema,
  /** `EXAM_TYPE` = mã dịch vụ khám; `TECHNICAL_SERVICE` = id dịch vụ kỹ thuật. */
  ref: z.string().min(1),
});
export type ServiceNormQuery = z.infer<typeof serviceNormQuerySchema>;

export const serviceNormLineInputSchema = z.object({ drugId: z.string().uuid(), quantity: quantitySchema });
export type ServiceNormLineInput = z.infer<typeof serviceNormLineInputSchema>;

/** Thay NGUYÊN danh sách định mức của dịch vụ (rỗng = xoá hết). */
export const putServiceNormRequestSchema = z.object({
  lines: z.array(serviceNormLineInputSchema).max(MAX_CONSUMPTION_LINES).superRefine(uniqueDrugs),
});
export type PutServiceNormRequest = z.infer<typeof putServiceNormRequestSchema>;

/** 1 mặt hàng trong định mức/phiếu — kèm thông tin hiển thị; `baseUnitCode` là mã đơn vị cơ sở (web tra tên). */
export const consumptionDrugInfoSchema = z.object({
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  itemType: drugItemTypeSchema,
  baseUnitCode: z.string().nullable(),
});

export const serviceNormLineSchema = consumptionDrugInfoSchema.extend({ quantity: z.number().int() });
export type ServiceNormLine = z.infer<typeof serviceNormLineSchema>;

export const serviceNormResponseSchema = z.object({
  kind: serviceConsumptionKindSchema,
  ref: z.string(),
  lines: z.array(serviceNormLineSchema),
});
export type ServiceNormResponse = z.infer<typeof serviceNormResponseSchema>;

// ---------------- Ghi tiêu hao ----------------
export const consumptionTargetSchema = z.object({ kind: consumptionTargetKindSchema, id: z.string().uuid() });
export type ConsumptionTarget = z.infer<typeof consumptionTargetSchema>;

export const recordConsumptionRequestSchema = z.object({
  encounterId: z.string().uuid(),
  target: consumptionTargetSchema,
  lines: z.array(z.object({ drugId: z.string().uuid(), quantity: quantitySchema })).min(1, 'Phải có ít nhất 1 vật tư hoặc thuốc.').max(MAX_CONSUMPTION_LINES).superRefine(uniqueDrugs),
});
export type RecordConsumptionRequest = z.infer<typeof recordConsumptionRequestSchema>;

export const reverseConsumptionRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Phải nhập lý do đảo phiếu.').max(500),
});
export type ReverseConsumptionRequest = z.infer<typeof reverseConsumptionRequestSchema>;

/** 1 dòng đã ghi (mỗi lô một dòng). `unitCost` CHỈ có với người có quyền xem giá vốn. */
export const consumptionRecordLineSchema = consumptionDrugInfoSchema.extend({
  quantity: z.number().int(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  unitCost: z.number().int().nullable(),
});
export type ConsumptionRecordLine = z.infer<typeof consumptionRecordLineSchema>;

export const consumptionRecordSchema = z.object({
  /** Id phiếu xuất (`stock_issue`) loại tiêu hao. */
  id: z.string().uuid(),
  issueNo: z.string(),
  occurredAt: z.string(),
  performedBy: z.string().uuid(),
  performedByName: z.string(),
  lines: z.array(consumptionRecordLineSchema),
  /** Tổng giá vốn — CHỈ có với người có quyền xem giá vốn. */
  totalCost: z.number().int().nullable(),
});
export type ConsumptionRecord = z.infer<typeof consumptionRecordSchema>;

/** Một lượt dịch vụ của lượt khám + định mức + phiếu đã ghi (nếu có). */
export const consumptionServiceSchema = z.object({
  target: consumptionTargetSchema,
  serviceKind: serviceConsumptionKindSchema,
  serviceCode: z.string().nullable(),
  serviceName: z.string(),
  /** Trạng thái hiển thị của lượt dịch vụ (dòng chỉ định: ORDERED/IN_PROGRESS/RESULTED/COMPLETED; dịch vụ khám: null). */
  status: z.string().nullable(),
  norm: z.array(serviceNormLineSchema),
  record: consumptionRecordSchema.nullable(),
});
export type ConsumptionService = z.infer<typeof consumptionServiceSchema>;

export const encounterConsumptionResponseSchema = z.object({
  encounterId: z.string().uuid(),
  /** Người xem có quyền xem giá vốn hay không (quyết định `unitCost`/`totalCost` có giá trị). */
  canSeeCost: z.boolean(),
  services: z.array(consumptionServiceSchema),
});
export type EncounterConsumptionResponse = z.infer<typeof encounterConsumptionResponseSchema>;
