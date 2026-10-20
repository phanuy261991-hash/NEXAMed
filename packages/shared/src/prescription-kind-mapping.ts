import { z } from 'zod';
import { drugControlTypeSchema } from './drug';
import { prescriptionKindSchema } from './business-code';

/**
 * Bảng ánh xạ "loại thuốc → loại đơn Bộ Y tế" (docs/DECISIONS.md #242, giai đoạn 2; mockup mục 4 đã chốt) — cấu hình CHUNG cả công ty (không theo chi nhánh),
 * lưu ở `tenant_setting` key `prescription_kind_mapping`. Mặc định: gây nghiện → N; hướng thần và tiền chất → H; thuốc độc và thuốc thường → C; thuốc Đông y → Y.
 * Khi một thuốc khớp nhiều dòng (vừa kiểm soát đặc biệt vừa Đông y) thì lấy loại ưu tiên cao nhất theo thứ tự N, H, Y, C.
 * Dòng "Thuốc Đông y" chỉ nhận Y hoặc C; dòng kê tự do luôn là C (không có trong bảng, không đổi được).
 */
export const prescriptionKindMappingSchema = z.object({
  NARCOTIC: prescriptionKindSchema,
  PSYCHOTROPIC: prescriptionKindSchema,
  PRECURSOR: prescriptionKindSchema,
  TOXIC: prescriptionKindSchema,
  NORMAL: prescriptionKindSchema,
  TRADITIONAL: z.enum(['Y', 'C']),
});
export type PrescriptionKindMappingDto = z.infer<typeof prescriptionKindMappingSchema>;

/** Danh sách dòng của bảng ánh xạ theo thứ tự hiển thị ở trang "Loại đơn thuốc". */
export const PRESCRIPTION_KIND_MAPPING_ROWS = ['NARCOTIC', 'PSYCHOTROPIC', 'PRECURSOR', 'TOXIC', 'NORMAL', 'TRADITIONAL'] as const;
export type PrescriptionKindMappingRow = (typeof PRESCRIPTION_KIND_MAPPING_ROWS)[number];

export const prescriptionKindMappingResponseSchema = z.object({
  mapping: prescriptionKindMappingSchema,
  /** Giá trị mặc định (nút "Khôi phục mặc định" và cột "Mặc định" ở web). */
  defaults: prescriptionKindMappingSchema,
});
export type PrescriptionKindMappingResponse = z.infer<typeof prescriptionKindMappingResponseSchema>;

export const updatePrescriptionKindMappingRequestSchema = prescriptionKindMappingSchema;
export type UpdatePrescriptionKindMappingRequest = z.infer<typeof updatePrescriptionKindMappingRequestSchema>;

// Giữ import `drugControlTypeSchema` có ý nghĩa: khoá của bảng PHẢI khớp các giá trị phân loại kiểm soát của thuốc (kiểm bằng test).
export const PRESCRIPTION_KIND_MAPPING_CONTROL_TYPES = drugControlTypeSchema.options;
