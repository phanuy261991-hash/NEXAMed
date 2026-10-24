import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { RolePermissionPane } from './RolePermissionPane';
import { UserAccountPane } from '../user-account/UserAccountPane';
import { DepartmentPane } from '../department/DepartmentPane';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';
import { useFilterByPermission } from '../auth/usePermission';
import { PermissionDeniedPage } from '../../shared/ui/PermissionDeniedPage';

/**
 * "Danh mục Tổ chức và Nhân sự" (`/admin/catalog-organization`, thay `ComingSoonPage`) — ADM-07 +
 * mở rộng ADM-01 (2026-08-20): "Quản lý tài khoản" (`UserAccountPane`), "Khoa/Phòng"
 * (`DepartmentPane`), và 4 pill danh mục nhân sự (Học vị/Học hàm, Chức danh, Trạng thái làm việc,
 * Hình thức làm việc) tái dùng nguyên `ReferenceCatalogPane` với `category` khác nhau — không
 * viết component mới, đúng khuôn `CatalogClinicalPage.tsx`.
 */
// `permission` = quyền của API mỗi pill gọi: tài khoản chỉ thấy pill dùng được (vd. `system_admin` chỉ có Quản lý tài khoản/Khoa-Phòng, không có Vai trò & Danh mục dùng chung).
const PILLS: ConfigScreenPill[] = [
  { key: 'roles', label: 'Vai trò & Phân quyền', permission: ['role_permission', 'manage'] },
  { key: 'accounts', label: 'Quản lý tài khoản', permission: ['user_account', 'manage'] },
  { key: 'departments', label: 'Khoa/Phòng', permission: ['user_account', 'read'] },
  { key: 'academic-title', label: 'Học vị/Học hàm', permission: ['reference_catalog', 'read'] },
  { key: 'position', label: 'Chức danh', permission: ['reference_catalog', 'read'] },
  { key: 'employment-status', label: 'Trạng thái làm việc', permission: ['reference_catalog', 'read'] },
  { key: 'employment-type', label: 'Hình thức làm việc', permission: ['reference_catalog', 'read'] },
];

export function RolePermissionPage() {
  const pills = useFilterByPermission(PILLS);
  const [selectedPillKey, setActivePillKey] = useState<string | null>(null);
  const activePill = pills.find((p) => p.key === selectedPillKey) ?? pills[0];
  const activePillKey = activePill?.key ?? '';

  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục Tổ chức và Nhân sự', to: '/admin/catalog-organization' },
    { label: activePill?.label ?? 'Không có quyền truy cập' },
  ]);

  if (!activePill) return <PermissionDeniedPage />;

  return (
    <ConfigScreenShell pageLabel="Danh mục Tổ chức và Nhân sự" pills={pills} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
      {activePillKey === 'roles' && <RolePermissionPane />}
      {activePillKey === 'accounts' && <UserAccountPane />}
      {activePillKey === 'departments' && <DepartmentPane />}
      {activePillKey === 'academic-title' && <ReferenceCatalogPane category="ACADEMIC_TITLE" categoryLabel="Học vị/Học hàm" />}
      {activePillKey === 'position' && <ReferenceCatalogPane category="STAFF_POSITION" categoryLabel="Chức danh" />}
      {activePillKey === 'employment-status' && (
        <ReferenceCatalogPane category="EMPLOYMENT_STATUS" categoryLabel="Trạng thái làm việc" />
      )}
      {activePillKey === 'employment-type' && (
        <ReferenceCatalogPane category="EMPLOYMENT_TYPE" categoryLabel="Hình thức làm việc" />
      )}
    </ConfigScreenShell>
  );
}