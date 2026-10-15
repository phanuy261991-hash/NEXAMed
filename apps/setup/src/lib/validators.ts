/**
 * Kiểm tra dữ liệu người cài nhập ở trình cài đặt (docs/DECISIONS.md #238). Hàm thuần, thông báo viết sẵn tiếng Việt cho người dùng cuối.
 * Mỗi hàm trả `{ ok: true, value }` (giá trị đã chuẩn hoá) hoặc `{ ok: false, error }`.
 */
export type Validation<T = string> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Tên miền: không giao thức/đường dẫn/cổng, các nhãn 1-63 ký tự chữ-số-gạch ngang, đuôi ít nhất 2 chữ cái. Ví dụ `phongkhamsaomai.vn`. */
export function validateDomain(input: string): Validation {
  const value = input.trim().toLowerCase().replace(/\.$/, '');
  if (!value) return fail('Nhập tên miền.');
  if (/[/:\s@]/.test(value)) return fail('Chỉ nhập tên miền, không kèm http://, đường dẫn hay cổng. Ví dụ: phongkhamsaomai.vn');
  const labels = value.split('.');
  if (labels.length < 2) return fail('Tên miền cần có phần đuôi, ví dụ .vn hoặc .com.');
  if (value.length > 253) return fail('Tên miền quá dài.');
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return fail('Tên miền chỉ gồm chữ không dấu, số và gạch ngang, không bắt đầu hoặc kết thúc bằng gạch ngang.');
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return fail('Phần đuôi tên miền (như .vn, .com) chỉ gồm chữ cái.');
  return { ok: true, value };
}

export function validateEmail(input: string): Validation {
  const value = input.trim();
  if (!value) return fail('Nhập địa chỉ email.');
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return fail('Địa chỉ email chưa đúng, ví dụ ha@saomai.vn.');
  return { ok: true, value };
}

export function validateRequiredText(input: string, label: string, maxLength = 150): Validation {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return fail(`Nhập ${label}.`);
  if (value.length > maxLength) return fail(`${label[0]!.toUpperCase()}${label.slice(1)} tối đa ${maxLength} ký tự.`);
  return { ok: true, value };
}

/** Tên đăng nhập: 3-50 ký tự gồm chữ, số, `.`, `_`, `-`; không dấu cách (người dùng gõ nhiều lần mỗi ngày). */
export function validateUsername(input: string): Validation {
  const value = input.trim();
  if (value.length < 3) return fail('Tên đăng nhập cần từ 3 ký tự.');
  if (value.length > 50) return fail('Tên đăng nhập tối đa 50 ký tự.');
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return fail('Tên đăng nhập chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới và gạch ngang.');
  return { ok: true, value };
}

export interface PasswordStrength {
  /** 0 (rất yếu) đến 4 (mạnh) — vẽ thanh đo độ mạnh. */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Rất yếu' | 'Yếu' | 'Trung bình' | 'Khá' | 'Mạnh';
  /** Mật khẩu có đủ điều kiện tối thiểu (từ 12 ký tự, đủ ít nhất 3 trong 4 loại ký tự) để cho phép dùng. */
  acceptable: boolean;
  hint: string;
}

const COMMON_PASSWORDS = ['password', 'matkhau', '123456', 'qwerty', 'admin', 'nexamed', 'letmein'];

/** Đo độ mạnh mật khẩu người vận hành: độ dài là yếu tố chính, thêm điểm cho đa dạng ký tự, trừ điểm khi chứa từ thông dụng hoặc lặp một ký tự. */
export function assessPassword(password: string): PasswordStrength {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const lower = password.toLowerCase();
  const common = COMMON_PASSWORDS.some((word) => lower.includes(word));
  const repeated = /^(.)\1+$/.test(password);
  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;
  if (classes >= 3) points += 1;
  if (classes === 4 && password.length >= 12) points += 1;
  if (common) points -= 2;
  if (repeated) points = 0;
  const score = Math.max(0, Math.min(4, points - (password.length === 0 ? 1 : 0))) as 0 | 1 | 2 | 3 | 4;
  const acceptable = password.length >= 12 && classes >= 3 && !common && !repeated;
  const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Khá', 'Mạnh'] as const;
  let hint = 'Mạnh. Tối thiểu 12 ký tự, nên có chữ hoa, số, ký hiệu.';
  if (password.length < 12) hint = 'Cần ít nhất 12 ký tự.';
  else if (classes < 3) hint = 'Thêm chữ hoa, chữ thường, số hoặc ký hiệu (ít nhất 3 loại).';
  else if (common || repeated) hint = 'Tránh từ thông dụng như "password" hay "admin" và chuỗi lặp.';
  return { score, label: labels[score], acceptable, hint };
}

export function validatePort(input: string | number): Validation<number> {
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fail('Cổng phải là số từ 1 đến 65535.');
  return { ok: true, value: n };
}

/** Địa chỉ IPv4 hoặc `localhost` dùng để nhân viên truy cập trong mạng nội bộ. */
export function validateLanAddress(input: string): Validation {
  const value = input.trim().toLowerCase();
  if (value === 'localhost') return { ok: true, value };
  const parts = value.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return { ok: true, value };
  return fail('Địa chỉ phải là IP trong mạng nội bộ (ví dụ 192.168.1.50) hoặc localhost.');
}

/** Thư mục sao lưu: đường dẫn tuyệt đối (Windows `D:\...`, UNC `\\máy\thư-mục`, hoặc Linux `/...`). Quyền ghi kiểm riêng bằng thử ghi thật. */
export function validateBackupDir(input: string): Validation {
  const value = input.trim();
  if (!value) return fail('Nhập thư mục lưu bản sao lưu.');
  const windowsAbs = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
  const unixAbs = value.startsWith('/');
  if (!windowsAbs && !unixAbs) return fail('Nhập đường dẫn đầy đủ, ví dụ D:\\NEXAMed-backup hoặc /mnt/backup.');
  if (/[<>"|?*]/.test(value)) return fail('Đường dẫn chứa ký tự không hợp lệ.');
  return { ok: true, value };
}

export function validateHour(input: number | string): Validation<number> {
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(n) || n < 0 || n > 23) return fail('Giờ chạy là số từ 0 đến 23.');
  return { ok: true, value: n };
}
