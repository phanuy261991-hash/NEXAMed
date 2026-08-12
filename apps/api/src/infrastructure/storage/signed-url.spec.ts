import { describe, expect, it } from 'vitest';
import { signFileToken, verifyFileToken } from './signed-url';

describe('signed-url (docs/DECISIONS.md #034) — token đọc file công khai có hạn', () => {
  const key = 'nexamed-test-encryption-key-please-change';
  const payload = { tenantId: 'tenant-1', key: 'patient/abc/photo/xyz.jpg', exp: Math.floor(Date.now() / 1000) + 60 };

  it('ký rồi verify đúng khoá → trả lại đúng payload', () => {
    const token = signFileToken(payload, key);
    expect(verifyFileToken(token, key)).toEqual(payload);
  });

  it('verify bằng khoá khác → null (chữ ký sai)', () => {
    const token = signFileToken(payload, key);
    expect(verifyFileToken(token, 'khoa-khac-hoan-toan-32-ky-tu-tro-len')).toBeNull();
  });

  it('sửa 1 ký tự trong token (giả mạo key/tenantId) → null', () => {
    const token = signFileToken(payload, key);
    const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(verifyFileToken(tampered, key)).toBeNull();
  });

  it('token đã hết hạn → null dù chữ ký đúng', () => {
    const expired = signFileToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, key);
    expect(verifyFileToken(expired, key)).toBeNull();
  });

  it('token hỏng định dạng (không có dấu chấm phân cách) → null, không ném lỗi', () => {
    expect(verifyFileToken('khong-phai-token-hop-le', key)).toBeNull();
  });

  it('token có phần thân không phải JSON hợp lệ sau khi giải mã → null, không ném lỗi', () => {
    const bogusBody = Buffer.from('khong-phai-json', 'utf8').toString('base64url');
    expect(verifyFileToken(`${bogusBody}.somesignature`, key)).toBeNull();
  });
});
