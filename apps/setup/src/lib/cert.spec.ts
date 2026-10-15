import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWildcardCertificate, parseSan } from './cert';

const read = (name: string): string => readFileSync(join(__dirname, '..', 'testing', name), 'utf8');
const wildcardCert = read('cert1.pem');
const wildcardKey = read('key1.pem');

describe('checkWildcardCertificate', () => {
  it('chấp nhận chứng chỉ bao *.gốc và gốc, khoá khớp, còn hạn', () => {
    const check = checkWildcardCertificate(wildcardCert, wildcardKey, 'example.test');
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.names).toEqual(['example.test', '*.example.test']);
    expect(check.validTo).toBeDefined();
  });
  it('từ chối chứng chỉ chỉ có tên gốc (thiếu wildcard)', () => {
    const check = checkWildcardCertificate(read('cert3.pem'), read('key1.pem'), 'example.test');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.includes('*.example.test'))).toBe(true);
  });
  it('từ chối chứng chỉ của tên miền khác', () => {
    const check = checkWildcardCertificate(read('cert2.pem'), wildcardKey, 'example.test');
    expect(check.ok).toBe(false);
    expect(check.errors.some((e) => e.includes('không bao'))).toBe(true);
  });
  it('từ chối khoá không khớp', () => {
    const check = checkWildcardCertificate(read('cert2.pem'), wildcardKey, 'other.test');
    expect(check.errors.some((e) => e.includes('không khớp'))).toBe(true);
  });
  it('từ chối chứng chỉ đã hết hạn / chưa hiệu lực theo giờ truyền vào', () => {
    const future = new Date('2200-01-01T00:00:00Z');
    expect(checkWildcardCertificate(wildcardCert, wildcardKey, 'example.test', future).errors.some((e) => e.includes('hết hạn'))).toBe(true);
    const past = new Date('2000-01-01T00:00:00Z');
    expect(checkWildcardCertificate(wildcardCert, wildcardKey, 'example.test', past).errors.some((e) => e.includes('chưa đến ngày'))).toBe(true);
  });
  it('báo lỗi dễ hiểu với nội dung không phải PEM', () => {
    expect(checkWildcardCertificate('rác', wildcardKey, 'example.test').errors[0]).toContain('Không đọc được file chứng chỉ');
    const badKey = checkWildcardCertificate(wildcardCert, 'rác', 'example.test');
    expect(badKey.errors.some((e) => e.includes('khoá riêng'))).toBe(true);
  });
  it('parseSan lấy đúng các tên DNS', () => {
    expect(parseSan('DNS:a.vn, DNS:*.a.vn, IP Address:1.2.3.4')).toEqual(['a.vn', '*.a.vn']);
    expect(parseSan(undefined)).toEqual([]);
  });
});
