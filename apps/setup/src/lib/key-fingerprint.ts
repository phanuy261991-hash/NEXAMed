import { createHash } from 'node:crypto';

/**
 * MÃ KIỂM KHOÁ (docs/DECISIONS.md #262): 8 ký tự hex đầu của SHA-256("nexamed-key-check:v1:" + khoá), viết hoa, chia đôi bằng dấu gạch — ví dụ `7F3A-91C2`.
 * Chỉ để ĐỐI CHIẾU bằng mắt/máy xem hai khoá có cùng là một không; 32 bit băm một chiều của khoá ngẫu nhiên 256 bit KHÔNG giúp suy ra khoá.
 * Bản VIẾT LẠI của `apps/api/src/infrastructure/crypto/key-fingerprint.ts` (trình cài đặt là ảnh độc lập, không dùng chung mã với API) — hai bản phải cho cùng kết quả: cùng một vector kiểm trong spec của mỗi bên.
 */
export function keyFingerprint(key: string): string {
  const hex = createHash('sha256').update(`nexamed-key-check:v1:${key}`, 'utf8').digest('hex').slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
