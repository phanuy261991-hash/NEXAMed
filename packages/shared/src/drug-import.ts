import { z } from 'zod';
import { referenceCatalogCategorySchema } from './reference-catalog';

/**
 * Nhập/Xuất Excel "Thuốc & Vật tư y tế" (docs/DECISIONS.md #210) — cùng khuôn "Nhập Excel lịch làm
 * việc" (`work-shift-assignment.ts`): `preview` CHỈ đọc + đối chiếu (không ghi gì) trả các nhóm để
 * người dùng tự xem, rồi `commit` đọc lại ĐÚNG file đó và ghi. File gồm 3 sheet liên kết theo Mã
 * thuốc ("Thuốc & Vật tư" 1 dòng/mặt hàng, "Hoạt chất", "Quy đổi đơn vị"); trong file người dùng điền
 * TÊN (Đơn vị/Hãng sản xuất/Hoạt chất/...) — hệ thống tự đối chiếu với danh mục dùng chung, tên chưa
 * có thì TỰ TẠO MỚI lúc commit (chủ dự án chốt 2026-10-01; xem `newCatalogItems` ở response).
 */

/** Tối đa mặt hàng/lần nhập — chặn file quá lớn làm nghẽn request (đọc cả file trong bộ nhớ). */
export const DRUG_IMPORT_MAX_ROWS = 2000;

/** Dòng có Mã bắt đầu bằng tiền tố này là DÒNG VÍ DỤ trong file mẫu — luôn bị bỏ qua (không nhập,
 * không báo lỗi), để người dùng quên xoá cũng không sinh dữ liệu rác. Do đó mã mặt hàng THẬT không
 * được bắt đầu bằng tiền tố này. So khớp không phân biệt hoa thường. */
export const DRUG_IMPORT_EXAMPLE_CODE_PREFIX = 'VD-';

/** Lỗi một dòng — `sheet` là tên sheet trong file ("Thuốc & Vật tư"/"Hoạt chất"/"Quy đổi đơn vị"). */
export const drugImportRowErrorSchema = z.object({
  sheet: z.string(),
  rowNumber: z.number().int(),
  code: z.string(),
  reason: z.string(),
});
export type DrugImportRowError = z.infer<typeof drugImportRowErrorSchema>;

export const drugImportValidRowSchema = z.object({
  rowNumber: z.number().int(),
  code: z.string(),
  name: z.string(),
  itemType: z.enum(['MEDICINE', 'SUPPLY']),
  ingredientCount: z.number().int(),
  unitCount: z.number().int(),
});
export type DrugImportValidRow = z.infer<typeof drugImportValidRowSchema>;

/** Mục danh mục dùng chung SẼ ĐƯỢC TẠO MỚI khi commit (tên có trong file nhưng chưa có trong danh mục). */
export const drugImportNewCatalogItemSchema = z.object({
  category: referenceCatalogCategorySchema,
  name: z.string(),
});
export type DrugImportNewCatalogItem = z.infer<typeof drugImportNewCatalogItemSchema>;

export const drugImportPreviewResponseSchema = z.object({
  validRows: z.array(drugImportValidRowSchema),
  /** Mã đã có trong hệ thống — luôn bỏ qua (không ghi đè). */
  duplicateRows: z.array(drugImportValidRowSchema),
  errorRows: z.array(drugImportRowErrorSchema),
  newCatalogItems: z.array(drugImportNewCatalogItemSchema),
  /** Số dòng ví dụ (Mã bắt đầu bằng `VD-`) đã bỏ qua, cộng cả 3 sheet. */
  exampleRowCount: z.number().int(),
});
export type DrugImportPreviewResponse = z.infer<typeof drugImportPreviewResponseSchema>;

export const drugImportCommitResponseSchema = z.object({
  createdCount: z.number().int(),
  duplicateCount: z.number().int(),
  errorCount: z.number().int(),
  newCatalogItemCount: z.number().int(),
});
export type DrugImportCommitResponse = z.infer<typeof drugImportCommitResponseSchema>;
