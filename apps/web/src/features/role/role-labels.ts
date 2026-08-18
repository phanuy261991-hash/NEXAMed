/**
 * Nhãn tiếng Việt cho 5 TÊN vai trò hệ thống (`USER_ROLES`, packages/shared/src/roles.ts) — thuần
 * trình bày ở màn "Vai trò & Phân quyền". KHÔNG đổi giá trị `role.name` thật lưu trong DB/dùng để
 * so khớp quyền (Sidebar.tsx, `role_permission`, `DEFAULT_ROLE_PERMISSIONS`) — chỉ dịch lúc hiển
 * thị, cùng cách `permission-grouping.ts` dịch tên module. Vai trò tuỳ biến (ADM-07) không cần
 * dịch vì tên đã do `clinic_admin` tự đặt bằng tiếng Việt ngay từ lúc tạo.
 */
const ROLE_LABELS: Record<string, string> = {
  receptionist: 'Lễ tân',
  nurse: 'Điều dưỡng',
  doctor: 'Bác sĩ',
  clinic_admin: 'Quản lý phòng khám',
  system_admin: 'Quản trị hệ thống',
};

export function roleLabel(name: string): string {
  return ROLE_LABELS[name] ?? name;
}