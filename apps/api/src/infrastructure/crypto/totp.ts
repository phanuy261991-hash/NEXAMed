import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mã xác thực một lần theo thời gian (TOTP, RFC 6238: HMAC-SHA1, 6 chữ số, bước 30 giây) cho đăng nhập người vận hành nền tảng (docs/DECISIONS.md #237).
 * Tự viết bằng `node:crypto` (không thêm thư viện) vì thuật toán nhỏ và có vector kiểm chuẩn trong RFC; tương thích Google Authenticator, Microsoft Authenticator, Authy...
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

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

/** Bí mật mới 160 bit (20 byte) — độ dài RFC khuyến nghị cho HMAC-SHA1 — dạng base32 để nhập vào ứng dụng xác thực. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Mã TOTP tại một thời điểm (`timeMs` mili-giây). Công khai để test đối chiếu vector RFC 6238. */
export function totpAt(secretBase32: string, timeMs: number, digits = DIGITS): string {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Số thứ tự bước 30 giây của một thời điểm (`timeMs` mili-giây) — khoá để biết một mã đã dùng chưa. */
export function totpStepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

/**
 * Tìm bước thời gian mà mã người dùng nhập khớp, chấp nhận lệch ±`window` bước (mặc định ±1 = ±30 giây, bù đồng hồ lệch). So sánh thời gian hằng số.
 * Trả SỐ THỨ TỰ BƯỚC khớp (xem `totpStepAt`), hoặc `null` nếu không khớp bước nào. Nơi gọi PHẢI ghi lại bước đã dùng và từ chối bước không lớn hơn bước đã ghi
 * (RFC 6238 mục 5.2) — nếu không thì một mã bị lộ dùng lại được suốt cửa sổ ~90 giây (docs/DECISIONS.md #244).
 */
export function matchTotpStep(secretBase32: string, code: string, nowMs: number, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const at = nowMs + offset * STEP_SECONDS * 1000;
    const expected = Buffer.from(totpAt(secretBase32, at));
    // Không dừng sớm khi khớp để thời gian xử lý không lộ bước nào đúng.
    if (timingSafeEqual(given, expected)) matched = totpStepAt(at);
  }
  return matched;
}

/** Chỉ kiểm mã đúng/sai, KHÔNG chống dùng lại — chỉ dùng cho kiểm tra không có tác dụng đăng nhập (test, công cụ). Đăng nhập phải dùng `matchTotpStep` + ghi bước đã dùng. */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, window = 1): boolean {
  return matchTotpStep(secretBase32, code, nowMs, window) !== null;
}

/** Địa chỉ `otpauth://` để quét mã QR hoặc nhập vào ứng dụng xác thực. */
export function buildOtpAuthUri(secretBase32: string, accountName: string, issuer = 'NEXAMed'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
