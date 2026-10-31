import { z } from 'zod';
import { referenceCatalogCategorySchema } from './reference-catalog';
import { technicalServiceKindSchema } from './technical-service';

/**
 * Nhập/Xuất Excel "Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — cùng khuôn "Nhập Excel Thuốc & Vật tư" (`drug-import.ts`, #210): `preview` CHỈ đọc + đối chiếu
 * (không ghi gì) trả các nhóm để người dùng xem và SỬA FILE, rồi `commit` đọc lại ĐÚNG file đó và ghi trong một giao dịch. Mã dịch vụ tự sinh theo loại (XN/CD/TD)
 * nên file KHÔNG có cột Mã; "đã có sẵn" = trùng Loại + Tên (không phân biệt hoa/thường/dấu). Chỉ nhập dịch vụ + một đơn giá gốc; chỉ số xét nghiệm tạo ở màn Chỉ số.
 */

/** Tối đa dịch vụ/lần nhập — chặn file quá lớn làm nghẽn request (đọc cả file trong bộ nhớ). */
export const TECHNICAL_SERVICE_IMPORT_MAX_ROWS = 2000;

/** Dòng có Tên bắt đầu bằng tiền tố này là DÒNG VÍ DỤ trong file mẫu — luôn bị bỏ qua (không nhập, không báo lỗi). So khớp không phân biệt hoa thường. */
export const TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX = 'VD-';

/** Lỗi một dòng: `name` là tên dịch vụ ở dòng đó (để người dùng tìm lại trong file), `reason` nêu rõ cột sai và cách sửa. */
export const technicalServiceImportRowErrorSchema = z.object({
  sheet: z.string(),
  rowNumber: z.number().int(),
  name: z.string(),
  reason: z.string(),
});
export type TechnicalServiceImportRowError = z.infer<typeof technicalServiceImportRowErrorSchema>;

export const technicalServiceImportRowSchema = z.object({
  rowNumber: z.number().int(),
  name: z.string(),
  serviceKind: technicalServiceKindSchema,
  /** Đơn giá gốc trong file (đồng); `null` với dịch vụ chỉ định ra ngoài (không có giá). */
  price: z.number().int().nonnegative().nullable(),
});
export type TechnicalServiceImportRow = z.infer<typeof technicalServiceImportRowSchema>;

/** Mục danh mục dùng chung SẼ ĐƯỢC TẠO MỚI khi commit (tên có trong file nhưng chưa có trong danh mục). */
export const technicalServiceImportNewCatalogItemSchema = z.object({
  category: referenceCatalogCategorySchema,
  name: z.string(),
});
export type TechnicalServiceImportNewCatalogItem = z.infer<typeof technicalServiceImportNewCatalogItemSchema>;

export const technicalServiceImportPreviewResponseSchema = z.object({
  validRows: z.array(technicalServiceImportRowSchema),
  /** Dịch vụ đã có trong hệ thống (trùng Loại + Tên) — luôn bỏ qua (không ghi đè). */
  duplicateRows: z.array(technicalServiceImportRowSchema),
  errorRows: z.array(technicalServiceImportRowErrorSchema),
  newCatalogItems: z.array(technicalServiceImportNewCatalogItemSchema),
  /** Số dòng ví dụ (Tên bắt đầu bằng `VD-`) đã bỏ qua. */
  exampleRowCount: z.number().int(),
});
export type TechnicalServiceImportPreviewResponse = z.infer<typeof technicalServiceImportPreviewResponseSchema>;

export const technicalServiceImportCommitResponseSchema = z.object({
  createdCount: z.number().int(),
  duplicateCount: z.number().int(),
  errorCount: z.number().int(),
  newCatalogItemCount: z.number().int(),
});
export type TechnicalServiceImportCommitResponse = z.infer<typeof technicalServiceImportCommitResponseSchema>;
