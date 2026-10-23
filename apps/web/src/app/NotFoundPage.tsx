import { useBreadcrumb } from '../shared/layout/breadcrumb.context';
import { AppErrorScreen } from '../shared/ui/AppErrorScreen';

/**
 * Route `*` — đường dẫn không khớp trang nào. Theo quy tắc "mọi lỗi dẫn về một màn thông báo cụ thể, không hiện 404 hay tương tự"
 * (docs/DECISIONS.md #255) nên KHÔNG còn trang ghi "Không tìm thấy trang": hiện thông báo tiếng Việt kèm nút về trang chủ / quay lại. Gắn trong cây `/`
 * (trong `AppShell`, sau `RequireAuth`) nên vẫn có thanh bên/thanh trên để người dùng đi tiếp.
 */
export function NotFoundPage() {
  useBreadcrumb([{ label: 'Không mở được trang' }]);
  return <AppErrorScreen kind="notFound" embedded />;
}
