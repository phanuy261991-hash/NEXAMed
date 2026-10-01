import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, permissionKey } from './permissions';
import { PERMISSION_COMPANIONS, getPermissionCompanions } from './permission-companions';

const CATALOG = new Set(PERMISSIONS.map((p) => permissionKey(p)));

describe('PERMISSION_COMPANIONS (quyền đi kèm, docs/DECISIONS.md #208)', () => {
  it('mọi khoá và mọi quyền đi kèm đều có trong danh mục permission (không gợi ý quyền không tồn tại)', () => {
    for (const [key, companions] of Object.entries(PERMISSION_COMPANIONS)) {
      expect(CATALOG.has(key), `khoá ${key} không có trong PERMISSIONS`).toBe(true);
      for (const c of companions) expect(CATALOG.has(c), `${key} → ${c} không có trong PERMISSIONS`).toBe(true);
    }
  });

  it('không tự tham chiếu chính mình, không trùng lặp, và quyền đi kèm chỉ là quyền ĐỌC (gợi ý hiển thị, không leo thang quyền ghi)', () => {
    for (const [key, companions] of Object.entries(PERMISSION_COMPANIONS)) {
      expect(companions, `${key} tự tham chiếu`).not.toContain(key);
      expect(new Set(companions).size, `${key} có quyền đi kèm trùng lặp`).toBe(companions.length);
      for (const c of companions) expect(c.endsWith('.read'), `${key} → ${c} không phải quyền đọc`).toBe(true);
    }
  });

  /**
   * Khoảng trống ĐÃ BIẾT ở 5 vai trò mặc định — chỉ ảnh hưởng tính năng phụ của trang (không chặn việc chính), chủ ý
   * chưa xử lý (cấp thêm quyền đọc cho vai trò mặc định là thay đổi nghiệp vụ, cần chủ dự án quyết). Thêm khoảng trống
   * MỚI (quyền đi kèm mới mà vai trò mặc định chưa có) sẽ làm test fail để người sửa cân nhắc: cấp cho vai trò mặc định
   * hay thêm vào danh sách này kèm lý do.
   */
  const KNOWN_DEFAULT_ROLE_GAPS = new Set([
    // "Lịch làm việc nhân viên" (chỉ scope global/clinic_admin) liệt kê tài khoản; nhân viên scope personal chỉ dùng "Lịch của tôi".
    'receptionist: work_shift_assignment.read cần user_account.read',
    'nurse: work_shift_assignment.read cần user_account.read',
    'doctor: work_shift_assignment.read cần user_account.read',
    // Bộ lọc "Thu ngân" ở danh sách phiếu chốt ca liệt kê tài khoản; lễ tân chỉ xem ca của mình.
    'receptionist: cashier_shift.read cần user_account.read',
    // Form phiếu xuất kho thủ công tra tồn theo kho; lễ tân chỉ xem "Phát thuốc"/danh sách.
    'receptionist: stock_issue.read cần stock_receipt.read',
    // "Bệnh nhân trong ngày" lấy danh sách bác sĩ/ngưỡng chờ lâu từ API lịch hẹn (điều dưỡng không có appointment.read — bộ lọc bác sĩ trống).
    'nurse: encounter.read cần appointment.read',
    // Khối "Thanh toán" của phiếu nhập kho cần danh sách quỹ; điều dưỡng/bác sĩ chỉ xem tồn kho.
    'nurse: stock_receipt.read cần cash_account.read',
    'doctor: stock_receipt.read cần cash_account.read',
  ]);

  it('5 vai trò hệ thống mặc định đã có đủ quyền đi kèm cho mọi quyền họ giữ, trừ các khoảng trống đã biết (có ghi lý do)', () => {
    const gaps: string[] = [];
    for (const [role, matrix] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const key of Object.keys(matrix)) {
        for (const c of getPermissionCompanions(key)) {
          const gap = `${role}: ${key} cần ${c}`;
          if (!matrix[c] && !KNOWN_DEFAULT_ROLE_GAPS.has(gap)) gaps.push(gap);
        }
      }
    }
    expect(gaps, gaps.join('\n')).toEqual([]);
    // Danh sách "đã biết" không được chứa mục thừa (đã được cấp quyền / không còn là phụ thuộc) — tránh danh sách phình ra vô nghĩa.
    for (const known of KNOWN_DEFAULT_ROLE_GAPS) {
      const m = /^(\w+): (\S+) cần (\S+)$/.exec(known)!;
      const [, role, key, companion] = m as unknown as [string, string, string, string];
      const matrix = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS];
      expect(matrix[key] && !matrix[companion] && getPermissionCompanions(key).includes(companion), `mục thừa: ${known}`).toBeTruthy();
    }
  });

  it('getPermissionCompanions trả mảng rỗng cho quyền không có phụ thuộc / không tồn tại', () => {
    expect(getPermissionCompanions('patient.read')).toEqual([]);
    expect(getPermissionCompanions('khong.ton_tai')).toEqual([]);
  });
});
