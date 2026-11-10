import { z } from 'zod';

/**
 * Nhập/Xuất Excel "Giá trả đối tác" (docs/DECISIONS.md #291 GĐ4, mockup https://claude.ai/artifact/4AtH14tpo6mdrCAU3mvxVV): file RIÊNG, mỗi dòng một dịch vụ gửi đối tác, mỗi đối tác đang dùng một cột giá.
 * Ô giá để trống = giữ nguyên. Hệ thống chỉ ĐỔI giá của dịch vụ đã có và đã bật "Gửi đối tác" (không tạo dịch vụ mới). Cần quyền sửa dịch vụ kỹ thuật.
 */
export const LAB_PARTNER_PRICE_IMPORT_MAX_ROWS = 2_000;

export const labPartnerPriceImportChangeResultSchema = z.enum(['CHANGE', 'ADD', 'SAME']);
export type LabPartnerPriceImportChangeResult = z.infer<typeof labPartnerPriceImportChangeResultSchema>;

/** Một ô giá có nhập trong file: đổi giá, thêm mới (chưa có giá cho cặp này) hoặc trùng giá hiện tại. */
export const labPartnerPriceImportChangeSchema = z.object({
  rowNumber: z.number().int().positive(),
  serviceName: z.string(),
  partnerCode: z.string(),
  partnerName: z.string(),
  currentAmount: z.number().int().nonnegative().nullable(),
  newAmount: z.number().int().nonnegative(),
  result: labPartnerPriceImportChangeResultSchema,
});
export type LabPartnerPriceImportChange = z.infer<typeof labPartnerPriceImportChangeSchema>;

/** Lỗi một dòng — luôn có sheet, số dòng, tên dịch vụ và lý do (đã nêu tên cột + cách sửa). */
export const labPartnerPriceImportErrorSchema = z.object({
  sheet: z.string(),
  rowNumber: z.number().int().positive(),
  name: z.string(),
  reason: z.string(),
});
export type LabPartnerPriceImportError = z.infer<typeof labPartnerPriceImportErrorSchema>;

export const labPartnerPriceImportPreviewResponseSchema = z.object({
  /** Mọi ô giá có nhập (đã kiểm hợp lệ) — kể cả ô trùng giá hiện tại (`SAME`). Rỗng khi file còn lỗi. */
  changes: z.array(labPartnerPriceImportChangeSchema),
  /** Số dịch vụ có đổi đối tác mặc định. */
  defaultChangeCount: z.number().int().nonnegative(),
  /** Số ô giá bỏ trống (giữ nguyên) ở các dòng dịch vụ hợp lệ. */
  blankCellCount: z.number().int().nonnegative(),
  /** Số dòng dịch vụ trong file (không tính dòng ví dụ). */
  serviceRowCount: z.number().int().nonnegative(),
  errorRows: z.array(labPartnerPriceImportErrorSchema),
  /** Tiêu đề cột "Giá trả [mã]" của đối tác không còn dùng/không tồn tại — bị bỏ qua. */
  ignoredColumns: z.array(z.string()),
  exampleRowCount: z.number().int().nonnegative(),
});
export type LabPartnerPriceImportPreviewResponse = z.infer<typeof labPartnerPriceImportPreviewResponseSchema>;

export const labPartnerPriceImportCommitResponseSchema = z.object({
  /** Số ô giá thực sự đổi hoặc thêm mới. */
  updatedPriceCount: z.number().int().nonnegative(),
  updatedServiceCount: z.number().int().nonnegative(),
  defaultChangeCount: z.number().int().nonnegative(),
});
export type LabPartnerPriceImportCommitResponse = z.infer<typeof labPartnerPriceImportCommitResponseSchema>;
