import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { PrescriptionTemplatePane } from './PrescriptionTemplatePane';

/**
 * Trang "Đơn thuốc mẫu" (`/admin/prescription-templates`, docs/DECISIONS.md #196, mockup đã duyệt)
 * — quản lý ĐẦY ĐỦ (xem/sửa/ẩn) ngoài lúc kê đơn, khác popup "Đơn mẫu" trong `PrescriptionPanel.tsx`
 * (chỉ chọn dùng/lưu mẫu mới, không sửa/ẩn mẫu có sẵn). Cùng khuôn `SupplierManagementPage.tsx`
 * (page đơn, không pill — `useBreadcrumb` + `<h1 className="sr-only">` cho a11y).
 */
export function PrescriptionTemplateCatalogPage() {
  useBreadcrumb([{ label: 'Quản trị' }, { label: 'Đơn thuốc mẫu' }]);

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="sr-only">Đơn thuốc mẫu</h1>
      <PrescriptionTemplatePane />
    </div>
  );
}
