/**
 * Kiểm tra trạng thái công ty cho module KHÁC (docs/DECISIONS.md #237, Đợt 4 SaaS) — module `iam` (đăng nhập/làm mới phiên) không import module `tenant-context`, đọc qua port này.
 */
export interface TenantAccessPort {
  /** `true` nếu công ty đang bị người vận hành tạm ngưng. Công ty không tồn tại → `false` (để luồng đăng nhập hiện tại trả "sai thông tin" như cũ, không lộ công ty có tồn tại hay không). */
  isSuspended(tenantId: string): Promise<boolean>;
}

export const TENANT_ACCESS_PORT = Symbol('TENANT_ACCESS_PORT');
