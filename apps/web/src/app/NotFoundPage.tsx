import { CompassTool } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useBreadcrumb } from '../shared/layout/breadcrumb.context';
import { Button } from '../shared/ui/Button';
import { EmptyState } from '../shared/ui/EmptyState';

/**
 * Trang 404 thương hiệu — thay cho trang trắng mặc định của `react-router` ("Unexpected
 * Application Error!") khi URL không khớp route nào (docs/DECISIONS.md #048). Route `*` gắn
 * trong cây `/` (trong `AppShell`, sau `RequireAuth`) nên luôn render kèm sidebar/topbar như mọi
 * trang khác — không phải trang đứng riêng — giữ nguyên điều hướng để người dùng thoát ra dễ
 * dàng, cùng khuôn `DashboardPage`/`ComingSoonPage`.
 */
export function NotFoundPage() {
  useBreadcrumb([{ label: 'Không tìm thấy trang' }]);

  return (
    <div className="mx-auto max-w-[1400px] p-8">
      <h1 className="sr-only">Không tìm thấy trang</h1>
      <EmptyState
        icon={CompassTool}
        title="Không tìm thấy trang"
        description="Đường dẫn này không tồn tại hoặc đã đổi chỗ. Kiểm tra lại địa chỉ, hoặc quay về trang chủ."
        action={
          <Link to="/">
            <Button type="button">Về trang chủ</Button>
          </Link>
        }
      />
    </div>
  );
}
