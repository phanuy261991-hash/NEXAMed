/**
 * Cổng kiểm tra khoá mã hoá hệ thống trước khi GHI trường mã hoá (docs/DECISIONS.md #262). Module nào lưu dữ liệu mã hoá (CCCD, số thẻ BHYT, mật khẩu cổng liên thông) gọi `assertWritable` TRƯỚC khi mở
 * transaction ghi; khoá `ENCRYPTION_KEY` không khớp dữ liệu đã lưu thì ném `EncryptionKeyMismatchError` (409) để không trộn hai khoá trong cùng một cột. Cổng thay vì import thẳng module khác (CLAUDE.md,
 * "Module không import trực tiếp module khác"). Adapter: `EncryptionKeyService` ở `apps/api/src/modules/encryption-key`.
 */
export interface EncryptionKeyGuardPort {
  assertWritable(tenantId: string): Promise<void>;
}

export const ENCRYPTION_KEY_GUARD_PORT = Symbol('ENCRYPTION_KEY_GUARD_PORT');
