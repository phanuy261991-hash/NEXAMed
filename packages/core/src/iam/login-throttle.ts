/**
 * Chính sách giới hạn tần suất đăng nhập (docs/DECISIONS.md #258, sửa #244). Phần THUẦN — API đọc các hằng số/hàm này khi dựng `ThrottlerModule`.
 *
 * Vì sao hai lớp: giới hạn chỉ theo IP bị cả phòng khám dùng chung — nhân viên một phòng khám ra mạng qua CÙNG một IP (router văn phòng ở SaaS; ở PC Windows chạy Docker Desktop thì
 * mọi máy trạm hiện là cùng một IP của cổng mạng Docker, đã đo thật 23/10/2026), nên 15 người đăng nhập đầu ca là chạm trần 10 lần/phút. Tách thành:
 *  - **theo TÀI KHOẢN** (công ty + tên đăng nhập): chặn dò mật khẩu một tài khoản, không phụ thuộc IP — người này không làm người khác bị chặn;
 *  - **theo IP + công ty**, trần RỘNG hơn: chỉ còn vai trò chặn "rải" mật khẩu qua nhiều tài khoản. Trần phụ thuộc kiểu triển khai (xem hằng số bên dưới).
 */

export type DeploymentModeForThrottle = 'single' | 'saas';

/** Tối đa mỗi tài khoản/phút (đăng nhập sai LẪN đúng). Dò mật khẩu còn bị khoá tài khoản luỹ tiến (#239) chặn riêng. */
export const LOGIN_ACCOUNT_LIMIT_PER_MINUTE = 10;

/** SaaS: IP thật nhưng nhân viên một phòng khám chung IP văn phòng → đủ cho cả ca đăng nhập đầu giờ, vẫn chặn rải mật khẩu từ Internet. */
export const LOGIN_IP_LIMIT_SAAS_PER_MINUTE = 30;

/** Một công ty (on-prem/VPS/NAS): mọi máy đều ở mạng nội bộ phòng khám và có thể dùng chung IP → trần rộng hơn. */
export const LOGIN_IP_LIMIT_SINGLE_PER_MINUTE = 60;

/** Trần IP + công ty cho đăng nhập: theo kiểu triển khai, hoặc giá trị người vận hành đặt (`LOGIN_IP_LIMIT_PER_MINUTE`). */
export function resolveLoginIpLimit(mode: DeploymentModeForThrottle, override?: number | null): number {
  if (override !== undefined && override !== null) {
    if (!Number.isInteger(override) || override < 1) throw new RangeError('LOGIN_IP_LIMIT_PER_MINUTE phải là số nguyên dương.');
    return override;
  }
  return mode === 'saas' ? LOGIN_IP_LIMIT_SAAS_PER_MINUTE : LOGIN_IP_LIMIT_SINGLE_PER_MINUTE;
}
