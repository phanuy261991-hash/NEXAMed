/**
 * Kiểm tra file chứng chỉ wildcard người vận hành tải lên ở kiểu SaaS (docs/DECISIONS.md #238, câu 4A): phải bao `*.<tên miền gốc>` và `<tên miền gốc>`, còn hạn,
 * và khoá riêng khớp với chứng chỉ. Dùng `node:crypto` — không cần openssl trong ảnh.
 */
import { X509Certificate, createPrivateKey } from 'node:crypto';

export interface CertCheck {
  ok: boolean;
  /** Các lỗi bằng tiếng Việt, mỗi lỗi một câu. */
  errors: string[];
  /** Ngày hết hạn (ISO) khi đọc được chứng chỉ — hiện ở bước Xem lại. */
  validTo?: string;
  names: string[];
}

/** Danh sách tên trong phần Subject Alternative Name (dạng `DNS:a.com, DNS:*.a.com`). */
export function parseSan(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  return subjectAltName
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('DNS:'))
    .map((part) => part.slice(4));
}

export function checkWildcardCertificate(certPem: string, keyPem: string, baseDomain: string, now: Date = new Date()): CertCheck {
  const errors: string[] = [];
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    return { ok: false, errors: ['Không đọc được file chứng chỉ (.crt). Cần file định dạng PEM, bắt đầu bằng "-----BEGIN CERTIFICATE-----".'], names: [] };
  }
  const names = parseSan(cert.subjectAltName);
  // Phải có đúng `*.<gốc>` (phủ mọi công ty khách) và chính `<gốc>` (khu quản trị dùng tên con, nhưng trang gốc cũng cần HTTPS).
  const wildcard = `*.${baseDomain}`;
  const missing = [wildcard, baseDomain].filter((name) => !names.some((san) => san.toLowerCase() === name));
  for (const name of missing) {
    errors.push(`Chứng chỉ không bao ${name}. Chứng chỉ này chỉ có: ${names.length > 0 ? names.join(', ') : '(không có tên nào)'}.`);
  }
  const validTo = new Date(cert.validTo);
  const validFrom = new Date(cert.validFrom);
  if (Number.isFinite(validTo.getTime()) && validTo < now) errors.push('Chứng chỉ đã hết hạn.');
  if (Number.isFinite(validFrom.getTime()) && validFrom > now) errors.push('Chứng chỉ chưa đến ngày có hiệu lực.');
  try {
    const key = createPrivateKey(keyPem);
    if (!cert.checkPrivateKey(key)) errors.push('Khoá riêng (.key) không khớp với chứng chỉ (.crt).');
  } catch {
    errors.push('Không đọc được khoá riêng (.key). Cần file PEM không đặt mật khẩu.');
  }
  return { ok: errors.length === 0, errors, validTo: Number.isFinite(validTo.getTime()) ? validTo.toISOString() : undefined, names };
}
