import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { RolePermissionPane } from './RolePermissionPane';
import { UserAccountPane } from '../user-account/UserAccountPane';
import { DepartmentPane } from '../department/DepartmentPane';
import { ReferenceCatalogPane } from '../reference-catalog/ReferenceCatalogPane';

/**
 * "Danh mục Tổ chức và Nhân sự" (`/admin/catalog-organization`, thay `ComingSoonPage`) — ADM-07 +
 * mở rộng ADM-01 (2026-08-20): "Quản lý tài khoản" (`UserAccountPane`), "Khoa/Phòng"
 * (`DepartmentPane`), và 4 pill danh mục nhân sự (Học vị/Học hàm, Chức danh, Trạng thái làm việc,
 * Hình thức làm việc) tái dùng nguyên `ReferenceCatalogPane` với `category` khác nhau — không
 * viết component mới, đúng khuôn `CatalogClinicalPage.tsx`.
 */
const PILLS: ConfigScreenPill[] = [
  { key: 'roles', label: 'Vai trò & Phân quyền' },
  { key: 'accounts', label: 'Quản lý tài khoản' },
  { key: 'departments', label: 'Khoa/Phòng' },
  { key: 'academic-title', label: 'Học vị/Học hàm' },
  { key: 'position', label: 'Chức danh' },
  { key: 'employment-status', label: 'Trạng thái làm việc' },
  { key: 'employment-type', label: 'Hình thức làm việc' },
];
const FIRST_PILL = PILLS[0]!;

export function RolePermissionPage() {
  const [activePillKey, setActivePillKey] = useState(FIRST_PILL.key);
  const activePill = PILLS.find((p) => p.key === activePillKey) ?? FIRST_PILL;

  useBreadcrumb([
    { label: 'Quản trị' },
    { label: 'Danh mục Tổ chức và Nhân sự', to: '/admin/catalog-organization' },
    { label: activePill.label },
  ]);

  return (
    <ConfigScreenShell pageLabel="Danh mục Tổ chức và Nhân sự" pills={PILLS} activePillKey={activePillKey} onSelectPill={setActivePillKey}>
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