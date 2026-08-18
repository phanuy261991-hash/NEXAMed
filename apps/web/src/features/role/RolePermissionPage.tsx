import { useState } from 'react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { ConfigScreenShell, type ConfigScreenPill } from '../../shared/ui/ConfigScreenShell';
import { RolePermissionPane } from './RolePermissionPane';

/**
 * "Danh mục Tổ chức và Nhân sự" (`/admin/catalog-organization`, thay `ComingSoonPage`) — ADM-07.
 * Chỉ 1 pill "Vai trò & Phân quyền" hiện tại — chừa chỗ cho "Phòng ban"/"Tài khoản" (ADM-01, chưa
 * có UI web) sau, đúng khuôn `CatalogClinicalPage.tsx` (không dựng pill "Sắp có" cho tính năng
 * chưa xây, .claude/docs/ui-guidelines.md mục 10).
 */
const PILLS: ConfigScreenPill[] = [{ key: 'roles', label: 'Vai trò & Phân quyền' }];
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
    </ConfigScreenShell>
  );
}