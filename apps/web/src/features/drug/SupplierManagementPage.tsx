import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { SupplierPane } from './SupplierPane';

/**
 * Trang "Nhà cung cấp" (`/suppliers`) — tách khỏi pill con của "Danh mục Thuốc và Vật Tư" thành
 * nhóm sidebar riêng "Quản lý nhà cung cấp" theo yêu cầu chủ dự án (docs/DECISIONS.md #146/#148 —
 * `SupplierPane.tsx` không đổi, chỉ đổi nơi hiển thị). Cùng khuôn `WalletListPage.tsx` (page đơn,
 * không pill — `useBreadcrumb` + `<h1 className="sr-only">` cho a11y). Quyền `drug.manage` (dùng
 * lại, không permission mới).
 */
export function SupplierManagementPage() {
  useBreadcrumb([{ label: 'Quản lý nhà cung cấp' }, { label: 'Nhà cung cấp' }]);

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="sr-only">Nhà cung cấp</h1>
      <SupplierPane />
    </div>
  );
}
