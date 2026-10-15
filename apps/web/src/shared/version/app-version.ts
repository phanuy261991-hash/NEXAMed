/**
 * Phiên bản của CHÍNH gói web đang chạy trong trình duyệt (docs/DECISIONS.md #236) — nhúng lúc build, không đọc từ máy chủ. So với phiên bản máy chủ để phát hiện "máy chủ vừa được cập nhật
 * mà trình duyệt còn giữ gói web cũ". Không import `@nexamed/shared` ở dạng giá trị (bản dist là CommonJS, Vite dev không nạp được) — chỉ khai báo tại chỗ.
 */
export const WEB_VERSION: string = __APP_VERSION__;
export const WEB_BUILD_ID: string = __BUILD_ID__;

/** Dạng SemVer đầy đủ `phiên-bản+số-bản-dựng`, ví dụ `0.9.0+127` — dùng ở thông tin gửi hỗ trợ. Bản phát triển (`dev`) chỉ có số phiên bản. */
export function formatFullVersion(version: string, build: string): string {
  return build && build !== 'dev' ? `${version}+${build}` : version;
}

/** Dạng hiển thị cho người dùng: `0.9.0 · bản dựng 127` (đọc gọn hơn `0.9.0+127`). Bản phát triển chỉ hiện số phiên bản. */
export function formatDisplayVersion(version: string, build: string): string {
  return build && build !== 'dev' ? `${version} · bản dựng ${build}` : version;
}

/** Hai bản KHÁC nhau khi lệch số phiên bản hoặc mã bản dựng — kể cả cùng số phiên bản nhưng dựng lại (mã bản dựng đổi). */
export function isVersionMismatch(web: { version: string; build: string }, server: { version: string; build: string }): boolean {
  return web.version !== server.version || web.build !== server.build;
}

export const RELEASE_CHANNEL_LABELS: Record<'stable' | 'beta' | 'dev', string> = {
  stable: 'Ổn định',
  beta: 'Thử nghiệm',
  dev: 'Phát triển',
};

export const DEPLOYMENT_MODE_LABELS: Record<'single' | 'saas', string> = {
  single: 'Một công ty (máy chủ riêng)',
  saas: 'SaaS (nhiều công ty dùng chung)',
};
