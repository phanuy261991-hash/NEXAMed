import { Button } from '../../shared/ui/Button';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion, isVersionMismatch } from '../../shared/version/app-version';
import { useSystemVersionQuery } from './system.queries';

/**
 * Báo "hệ thống vừa được cập nhật" khi phiên bản máy chủ khác gói web đang chạy trong trình duyệt (docs/DECISIONS.md #236) — tránh lỗi hiển thị/gọi API lạ do gói web cũ nói chuyện với máy chủ mới.
 * Không render gì khi hai bên khớp hoặc chưa đọc được phiên bản máy chủ (không báo nhầm).
 */
export function VersionMismatchBanner() {
  const query = useSystemVersionQuery();
  const server = query.data;
  if (!server || !isVersionMismatch({ version: WEB_VERSION, build: WEB_BUILD_ID }, server)) return null;

  return (
    <div role="status" aria-live="polite" className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm font-semibold text-amber-800">
      <span>
        Hệ thống vừa được cập nhật lên phiên bản {formatDisplayVersion(server.version, server.build)}. Hãy tải lại trang để dùng bản mới, tránh lỗi hiển thị.
      </span>
      <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
        Tải lại trang
      </Button>
    </div>
  );
}
