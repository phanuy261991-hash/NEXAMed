import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mã xác thực một lần theo thời gian (TOTP, RFC 6238: HMAC-SHA1, 6 chữ số, bước 30 giây) cho bước "Kích hoạt OTP" của người vận hành SaaS (docs/DECISIONS.md #238).
 * Cùng thuật toán với `apps/api/src/infrastructure/crypto/totp.ts` (tách riêng vì trình cài đặt là ảnh Docker độc lập); cả hai có test cùng vector kiểm chuẩn của RFC.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Chuỗi base32 không hợp lệ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretBase32: string, timeMs: number, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Chấp nhận lệch ±1 bước (±30 giây) để bù đồng hồ điện thoại lệch. */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const given = Buffer.from(code);
  let ok = false;
  for (let step = -window; step <= window; step += 1) {
    if (timingSafeEqual(given, Buffer.from(totpAt(secretBase32, nowMs + step * STEP_SECONDS * 1000)))) ok = true;
  }
  return ok;
}

/** Địa chỉ `otpauth://` — nội dung của mã QR để quét bằng ứng dụng xác thực. */
export function buildOtpAuthUri(secretBase32: string, accountName: string, issuer = 'NEXAMed'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Hiển thị khoá theo nhóm 4 ký tự cho dễ nhập tay: `XMRA L53O TS4U ...`. */
export function groupSecret(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, '$1 ').trim();
}
