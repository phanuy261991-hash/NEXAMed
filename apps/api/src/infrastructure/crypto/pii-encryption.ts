import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Chuẩn hoá `ENCRYPTION_KEY` (chuỗi tuỳ ý, tối thiểu 32 ký tự) về đúng 32 byte cho AES-256. */
function normalizeKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

/**
 * Mã hoá một trường PII (CCCD, số thẻ BHYT...) bằng AES-256-GCM — xem .claude/docs/
 * security-audit.md mục "Dữ liệu định danh". Dùng chung cho mọi cột `*_enc` (bắt đầu từ
 * `patient.national_id_enc`, dùng lại cho `insurance_card.card_no_enc` ở S2-04). Output ghép
 * `iv || authTag || ciphertext` vào một Buffer để lưu thẳng vào cột `bytea`, không cần bảng phụ.
 */
export function encryptPii(plaintext: string, key: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, normalizeKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptPii(payload: Buffer, key: string): string {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, normalizeKey(key), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Hash một chiều, xác định (HMAC-SHA256 dùng `ENCRYPTION_KEY` làm khoá) để tra trùng chính xác
 * mà không phải giải mã hàng loạt để so sánh — .claude/docs/data-model.md gọi đây là "SHA-256 +
 * salt hệ thống". Dùng HMAC (keyed hash chuẩn) thay vì nối chuỗi `SHA256(salt + value)`, tái
 * dùng đúng `ENCRYPTION_KEY` đã có sẵn thay vì phải quản lý thêm một bí mật "salt" riêng.
 */
export function hashForLookup(value: string, key: string): string {
  return createHmac('sha256', normalizeKey(key)).update(value, 'utf8').digest('hex');
}
