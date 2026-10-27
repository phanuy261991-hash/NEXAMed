import { describe, expect, it } from 'vitest';
import { keyFingerprint } from './key-fingerprint';
import { buildKeyFileText } from './keyfile';

const KEY = '0123456789abcdef0123456789abcdef';

describe('buildKeyFileText (file khoá hệ thống, #262)', () => {
  const text = buildKeyFileText({ key: KEY, version: '0.9.0', publicUrl: 'http://192.168.3.20:8081', clinicName: 'Phòng khám Sao Mai', createdAt: new Date('2026-10-24T07:00:00Z') });

  it('chứa đúng dòng ENCRYPTION_KEY để dán vào .env, kèm mã kiểm khoá', () => {
    expect(text).toContain(`ENCRYPTION_KEY=${KEY}`);
    expect(text).toContain(keyFingerprint(KEY));
    expect(text).toContain('BE19-5018');
  });

  it('chỉ chứa khoá mã hoá — KHÔNG chứa mật khẩu cơ sở dữ liệu, JWT hay bí mật khác', () => {
    expect(text).not.toMatch(/JWT_SECRET|POSTGRES_PASSWORD|NEXAMED_APP_DB_PASSWORD|OTP/);
  });

  it('nói rõ khoá không nằm trong bản sao lưu và phải cất nơi khác máy chủ', () => {
    expect(text).toMatch(/NƠI KHÁC MÁY CHỦ/);
    expect(text).toMatch(/KHÔNG chứa khoá/);
    expect(text).toMatch(/KHÔNG có cách lấy lại/);
  });

  it('xuống dòng kiểu Windows (CRLF) để Notepad hiển thị đúng', () => {
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
