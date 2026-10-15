/** Địa chỉ đăng nhập không kèm giao thức: `https://saomai.tenmien.vn` → `saomai.tenmien.vn`. */
export function loginHostOf(loginUrl: string | null): string | null {
  return loginUrl ? loginUrl.replace(/^https?:\/\//, '') : null;
}

/** Ngày `dd/MM/yyyy` (giờ Việt Nam) từ mốc ISO. */
export function formatDateVn(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()}`;
}

/**
 * Địa chỉ đăng nhập DỰ KIẾN của một mã công ty, suy từ tên miền đang truy cập khu quản trị (`admin.tenmien.vn` → `<mã>.tenmien.vn`) — chỉ để xem trước trên form;
 * địa chỉ thật do máy chủ trả về sau khi tạo.
 */
export function previewLoginHost(code: string, currentHost: string): string {
  const parts = currentHost.split('.');
  return `${code || 'ma-cong-ty'}.${parts.slice(1).join('.')}`;
}

/** Cùng quy tắc với máy chủ (`checkTenantCode` ở `packages/core`) — chỉ để gợi ý sớm trên form; máy chủ vẫn kiểm lại. Web không nhập giá trị từ `@nexamed/core`. */
export const TENANT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
