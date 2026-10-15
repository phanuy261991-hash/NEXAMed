/**
 * File .txt bàn giao sau khi cài (docs/DECISIONS.md #238, câu 5A). Chứa địa chỉ, tài khoản, mật khẩu tạm và hướng dẫn sao lưu — KHÔNG chứa khoá hệ thống
 * (JWT_SECRET, ENCRYPTION_KEY, mật khẩu cơ sở dữ liệu) và không chứa bí mật OTP của người vận hành.
 */
import type { Profile } from './profiles';
import { PROFILE_LABEL } from './profiles';

export interface HandoffInput {
  profile: Profile;
  version: string;
  publicUrl: string;
  username: string;
  /** Mật khẩu tạm của quản trị viên phòng khám; SaaS không có (người vận hành tự đặt). */
  tempPassword?: string;
  clinicName?: string;
  backupDir: string;
  backupHourVn: number;
  retentionDays: number;
  installDir: string;
  createdAt: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatVnDateTime(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}

export function buildHandoffText(input: HandoffInput): string {
  const lines: string[] = [];
  lines.push(`THÔNG TIN BÀN GIAO NEXAMED ${input.version}`);
  lines.push(`Cài ngày ${formatVnDateTime(input.createdAt)} (giờ Việt Nam) - ${PROFILE_LABEL[input.profile]}`);
  lines.push('');
  lines.push('ĐĂNG NHẬP');
  lines.push(`  Địa chỉ        : ${input.publicUrl}`);
  if (input.clinicName) lines.push(`  Phòng khám     : ${input.clinicName}`);
  lines.push(`  Tên đăng nhập  : ${input.username}`);
  if (input.profile === 'saas') {
    lines.push('  Mật khẩu       : do người vận hành tự đặt lúc cài');
    lines.push('  Mã OTP         : đã kích hoạt trên điện thoại của người vận hành');
  } else {
    lines.push(`  Mật khẩu tạm   : ${input.tempPassword ?? ''}`);
    lines.push('  Hệ thống bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên. Mật khẩu tạm không xem lại được sau khi đóng trình cài đặt.');
  }
  lines.push('');
  lines.push('SAO LƯU');
  lines.push(`  Thư mục        : ${input.backupDir}`);
  lines.push(`  Chạy lúc       : ${pad(input.backupHourVn)}:00 hằng ngày (giờ Việt Nam), giữ ${input.retentionDays} ngày`);
  lines.push('  Nên chép định kỳ thư mục này sang ổ ngoài hoặc máy khác; nếu hỏng ổ đĩa chứa cả dữ liệu và bản sao thì mất tất cả.');
  lines.push('');
  lines.push('THƯ MỤC CÀI ĐẶT');
  lines.push(`  ${input.installDir}`);
  lines.push('  Tệp .env trong thư mục này chứa khoá hệ thống - KHÔNG gửi cho ai và KHÔNG xoá. Mất tệp này thì không đọc lại được dữ liệu đã mã hoá.');
  lines.push('');
  lines.push('NÂNG CẤP BẢN MỚI');
  lines.push('  Chạy lại lệnh nexamed-setup trong thư mục cài đặt (nexamed-setup.cmd trên Windows, ./nexamed-setup.sh trên Linux/NAS) và chọn "Nâng cấp".');
  lines.push('  Hệ thống tự sao lưu trước khi nâng cấp và tự quay về bản cũ nếu có lỗi.');
  lines.push('');
  return lines.join('\r\n');
}
