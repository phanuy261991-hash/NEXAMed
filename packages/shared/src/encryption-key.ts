import { z } from 'zod';

/**
 * `GET /encryption-key/status` (docs/DECISIONS.md #262) — khoá mã hoá hệ thống (`ENCRYPTION_KEY`) có khớp dữ liệu đã lưu không. `state: 'mismatch'` → số CCCD/thẻ BHYT không đọc được và hệ thống từ chối ghi
 * trường mã hoá mới. Mã kiểm khoá (băm cụt, KHÔNG phải khoá) chỉ trả cho người quản trị (`canSeeDetails`); người khác nhận `null`.
 */
export const encryptionKeyStateSchema = z.enum(['ok', 'mismatch']);
export type EncryptionKeyState = z.infer<typeof encryptionKeyStateSchema>;

export const encryptionKeyStatusResponseSchema = z.object({
  state: encryptionKeyStateSchema,
  actualFingerprint: z.string().nullable(),
  expectedFingerprint: z.string().nullable(),
  canSeeDetails: z.boolean(),
});
export type EncryptionKeyStatusResponse = z.infer<typeof encryptionKeyStatusResponseSchema>;
