import { describe, expect, it } from 'vitest';
import { checkDomainPointsHere, parseHostIps } from './dns';
import { buildHandoffText } from './handoff';

describe('checkDomainPointsHere', () => {
  const none = async () => null;
  it('trỏ đúng IP của máy', async () => {
    const r = await checkDomainPointsHere('a.vn', ['10.0.0.5'], { resolve4: async () => ['10.0.0.5'], publicIp: none });
    expect(r).toMatchObject({ status: 'ok', matched: '10.0.0.5' });
  });
  it('trỏ đúng IP công khai khi máy sau NAT/IP nổi', async () => {
    const r = await checkDomainPointsHere('a.vn', ['10.0.0.5'], { resolve4: async () => ['203.0.113.10'], publicIp: async () => '203.0.113.10' });
    expect(r).toMatchObject({ status: 'ok', matched: '203.0.113.10' });
  });
  it('trỏ sai: báo IP đã phân giải và IP mong đợi', async () => {
    const r = await checkDomainPointsHere('a.vn', ['10.0.0.5'], { resolve4: async () => ['1.1.1.1'], publicIp: async () => '203.0.113.10' });
    expect(r).toEqual({ status: 'mismatch', resolved: ['1.1.1.1'], expected: ['203.0.113.10', '10.0.0.5'] });
  });
  it('chưa phân giải được (lỗi hoặc rỗng)', async () => {
    expect((await checkDomainPointsHere('a.vn', [], { resolve4: async () => { throw new Error('ENOTFOUND'); }, publicIp: none })).status).toBe('unresolved');
    expect((await checkDomainPointsHere('a.vn', [], { resolve4: async () => [], publicIp: none })).status).toBe('unresolved');
  });
  it('parseHostIps bỏ giá trị không phải IPv4', () => {
    expect(parseHostIps('192.168.1.50, 10.0.0.2  abc 1.2.3')).toEqual(['192.168.1.50', '10.0.0.2']);
    expect(parseHostIps(undefined)).toEqual([]);
  });
});

describe('buildHandoffText', () => {
  const base = { version: '0.9.0', publicUrl: 'http://192.168.1.50', username: 'quantri', clinicName: 'Phòng khám Sao Mai', backupDir: 'D:\\NEXAMed-backup', backupHourVn: 2, retentionDays: 14, installDir: 'C:\\NEXAMed', createdAt: new Date('2026-10-15T10:30:00Z') };
  it('có địa chỉ, tài khoản, mật khẩu tạm, sao lưu; giờ theo múi Việt Nam; xuống dòng CRLF', () => {
    const text = buildHandoffText({ ...base, profile: 'lan', tempPassword: '7KqV-mT2x-Pa9n' });
    expect(text).toContain('http://192.168.1.50');
    expect(text).toContain('7KqV-mT2x-Pa9n');
    expect(text).toContain('15/10/2026 17:30');
    expect(text).toContain('02:00 hằng ngày');
    expect(text).toContain('\r\n');
  });
  it('KHÔNG chứa khoá hệ thống hay bí mật OTP; SaaS không in mật khẩu', () => {
    const text = buildHandoffText({ ...base, profile: 'saas', username: 'vanhanh' });
    expect(text).not.toMatch(/JWT_SECRET|POSTGRES_PASSWORD|ENCRYPTION_KEY=|otpauth/);
    expect(text).toContain('do người vận hành tự đặt');
  });
});
