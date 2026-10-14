import { z } from 'zod';

/**
 * "Chi nhánh" (docs/DECISIONS.md #231, mô hình B của #075) — `tenant` = công ty, chi nhánh nằm BÊN TRONG. Mọi tenant luôn có ít nhất 1
 * chi nhánh mặc định; giao diện ẩn mọi thứ liên quan chi nhánh khi công ty chỉ có 1 chi nhánh hoạt động.
 */

/** Dạng gọn dùng ở đăng nhập, bộ chuyển chi nhánh, nhãn trong lịch sử khám. */
export const branchLiteSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  isDefault: z.boolean(),
});
export type BranchLite = z.infer<typeof branchLiteSchema>;

export const branchSummarySchema = branchLiteSchema.extend({
  phone: z.string().nullable(),
  isActive: z.boolean(),
  /** Số tài khoản đang hoạt động được gán chi nhánh này. */
  staffCount: z.number().int(),
  version: z.number().int(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;

export const createBranchRequestSchema = z.object({
  // Tối đa 100 ký tự: tên chi nhánh hiện ở thanh đỉnh, hàng đợi, đầu phiếu in... — quá dài sẽ vỡ giao diện (#233).
  name: z.string().trim().min(1).max(100, 'Tên chi nhánh tối đa 100 ký tự.'),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(50).optional(),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = z.object({
  name: z.string().trim().min(1).max(100, 'Tên chi nhánh tối đa 100 ký tự.').optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;

export const listBranchesQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListBranchesQuery = z.infer<typeof listBranchesQuerySchema>;

export const listBranchesResponseSchema = z.object({ items: z.array(branchSummarySchema) });
export type ListBranchesResponse = z.infer<typeof listBranchesResponseSchema>;

/** `POST /auth/switch-branch` — đổi chi nhánh đang làm việc của phiên; `remember` mặc định true ("Nhớ lựa chọn cho lần sau"). */
export const switchBranchRequestSchema = z.object({
  branchId: z.string().uuid(),
  remember: z.boolean().optional().default(true),
});
export type SwitchBranchRequest = z.infer<typeof switchBranchRequestSchema>;

export const switchBranchResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  currentBranchId: z.string().uuid(),
});
export type SwitchBranchResponse = z.infer<typeof switchBranchResponseSchema>;

/**
 * Phạm vi chi nhánh của màn danh sách/báo cáo (Đợt 2 chi nhánh, docs/DECISIONS.md #233): mặc định CHỈ chi nhánh đang làm việc; `true` = mọi chi nhánh
 * tài khoản được gán (công ty 1 chi nhánh: không khác gì). Đợt 3 (báo cáo tổng hợp nhiều chi nhánh) dùng lại đúng trường này.
 */
export const allBranchesQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .default(false)
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));
