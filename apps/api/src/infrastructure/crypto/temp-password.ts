import { randomInt } from 'node:crypto';

/** Bỏ ký tự dễ nhầm khi đọc qua điện thoại/chép tay: 0/O, 1/l/I. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * Mật khẩu tạm cho tài khoản quản trị đầu tiên của công ty mới / sau khi đặt lại (docs/DECISIONS.md #237), dạng `7KqV-mT2x-Pa9n` (12 ký tự ngẫu nhiên mật mã học, ~70 bit).
 * Chỉ hiện đúng một lần cho người vận hành; tài khoản bị buộc đổi ở lần đăng nhập đầu (`mustChangePassword`).
 */
export function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let part = '';
    for (let i = 0; i < GROUP_LENGTH; i += 1) part += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(part);
  }
  return groups.join('-');
}
