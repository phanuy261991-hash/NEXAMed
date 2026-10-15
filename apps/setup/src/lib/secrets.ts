import { randomBytes, randomInt } from 'node:crypto';

/** Chuỗi hex ngẫu nhiên mật mã học — an toàn dùng thẳng trong URL kết nối cơ sở dữ liệu và file `.env` (không có ký tự đặc biệt cần escape). */
export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Bỏ ký tự dễ nhầm khi đọc qua điện thoại/chép tay: 0/O, 1/l/I. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Mật khẩu tạm cho tài khoản quản trị đầu tiên của phòng khám, dạng `7KqV-mT2x-Pa9n` (12 ký tự, ~70 bit). Cùng định dạng với `apps/api/src/infrastructure/crypto/temp-password.ts`
 * (tách riêng vì trình cài đặt là một ảnh Docker độc lập, không nhập mã của API).
 */
export function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g += 1) {
    let part = '';
    for (let i = 0; i < 4; i += 1) part += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(part);
  }
  return groups.join('-');
}

/** Mã một lần gắn vào link trình cài đặt trên máy chủ không màn hình (`?key=`): ngắn đủ để đọc/chép, đủ ngẫu nhiên để không đoán được. */
export function generateSetupKey(): string {
  let key = '';
  for (let i = 0; i < 12; i += 1) key += ALPHABET[randomInt(ALPHABET.length)];
  return `${key.slice(0, 4)}-${key.slice(4, 8)}-${key.slice(8)}`;
}
