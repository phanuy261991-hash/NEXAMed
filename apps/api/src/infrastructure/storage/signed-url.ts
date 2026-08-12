import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token đọc file công khai có hạn — đúng yêu cầu ".claude/docs/security-audit.md" mục "File
 * upload": "lưu ngoài web root; phục vụ qua signed URL có hạn". Lần đầu tiên hệ thống thật sự
 * phục vụ file (ảnh đại diện bệnh nhân, docs/DECISIONS.md #034) — dựng tối giản, tái dùng được
 * cho loại file khác sau này (đơn thuốc PDF, X-quang...). Token tự chứa {tenantId, key, exp} +
 * chữ ký HMAC, verify được ngay không cần tra DB (giống cách JWT stateless, nhưng phạm vi hẹp
 * hơn nhiều — chỉ đọc đúng một file trong một khoảng thời gian).
 */
export interface SignedFilePayload {
  tenantId: string;
  key: string;
  /** Epoch giây — hết hạn tại đúng thời điểm này. */
  exp: number;
}

// Nhãn dẫn xuất riêng cho mục đích ký URL — tránh dùng lại y nguyên khoá đã chuẩn hoá cho mã hoá
// PII (pii-encryption.ts normalizeKey()); cùng ENCRYPTION_KEY gốc nhưng khoá dẫn xuất khác nhau
// theo mục đích là thực hành mã hoá tốt (không tái sử dụng một khoá cho hai thuật toán/mục đích).
const SIGNING_KEY_LABEL = 'nexamed-file-url-v1';

function deriveSigningKey(encryptionKey: string): Buffer {
  return createHmac('sha256', encryptionKey).update(SIGNING_KEY_LABEL).digest();
}

export function signFileToken(payload: SignedFilePayload, encryptionKey: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', deriveSigningKey(encryptionKey)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Trả về payload nếu chữ ký đúng và chưa hết hạn; `null` nếu sai chữ ký/hết hạn/hỏng định dạng. */
export function verifyFileToken(token: string, encryptionKey: string): SignedFilePayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = createHmac('sha256', deriveSigningKey(encryptionKey)).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: SignedFilePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedFilePayload;
  } catch {
    return null;
  }
  if (typeof payload.tenantId !== 'string' || typeof payload.key !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
