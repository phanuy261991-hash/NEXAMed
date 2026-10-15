/**
 * Nhận biết công ty theo tên miền phụ ở chế độ SaaS (docs/DECISIONS.md #237). Hàm thuần — không đọc cấu hình hay mạng.
 * `https://saomai.nexamed.vn` → mã công ty `saomai`; `https://admin.nexamed.vn` → khu quản trị nền tảng; mọi địa chỉ khác → không nhận ra.
 */

/** Mã công ty cũng là một nhãn DNS: chữ thường/số/gạch ngang, 3-30 ký tự, không bắt đầu/kết thúc bằng gạch ngang. Khớp ràng buộc CHECK ở bảng `tenant`. */
export const TENANT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** Mã dành riêng cho hệ thống — không cấp cho công ty (tránh giả mạo trang quản trị, API, thư, hỗ trợ). */
export const RESERVED_TENANT_CODES: readonly string[] = ['admin', 'api', 'www', 'app', 'mail', 'static', 'platform', 'nexamed', 'support', 'status', 'cdn', 'ftp', 'smtp'];

export type TenantCodeCheck = 'ok' | 'format' | 'reserved';

export function checkTenantCode(code: string): TenantCodeCheck {
  if (!TENANT_CODE_PATTERN.test(code)) return 'format';
  if (RESERVED_TENANT_CODES.includes(code)) return 'reserved';
  return 'ok';
}

export type HostResolution = { kind: 'tenant'; code: string } | { kind: 'platform' } | { kind: 'unknown' };

export interface HostResolutionConfig {
  /** Tên miền gốc, ví dụ `nexamed.vn` (hoặc `localhost` khi chạy thử). */
  baseDomain: string;
  /** Nhãn tên miền phụ của khu quản trị nền tảng, mặc định `admin`. */
  adminSubdomain: string;
}

/** Bỏ cổng, chữ thường, bỏ dấu chấm cuối (FQDN) — `Saomai.NexaMed.vn:443.` → `saomai.nexamed.vn`. */
export function normalizeHost(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  let host = hostHeader.trim().toLowerCase();
  // IPv6 dạng [::1]:3000 không phải tên miền công ty — loại sớm.
  if (host.startsWith('[')) return null;
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  return host.length > 0 ? host : null;
}

export function resolveHost(hostHeader: string | undefined, config: HostResolutionConfig): HostResolution {
  const host = normalizeHost(hostHeader);
  const base = config.baseDomain.trim().toLowerCase();
  if (!host || !base) return { kind: 'unknown' };
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return { kind: 'unknown' };
  const label = host.slice(0, -suffix.length);
  // Đúng MỘT nhãn: `a.b.nexamed.vn` không phải công ty nào.
  if (label.length === 0 || label.includes('.')) return { kind: 'unknown' };
  if (label === config.adminSubdomain) return { kind: 'platform' };
  return TENANT_CODE_PATTERN.test(label) ? { kind: 'tenant', code: label } : { kind: 'unknown' };
}
