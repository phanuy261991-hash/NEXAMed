import { describe, expect, it } from 'vitest';
import { checkTenantCode, normalizeHost, resolveHost } from './tenant-host';

const config = { baseDomain: 'nexamed.vn', adminSubdomain: 'admin' };

describe('checkTenantCode', () => {
  it('chấp nhận nhãn DNS hợp lệ 3-30 ký tự', () => {
    for (const ok of ['saomai', 'an-tam', 'abc', 'a1b', 'phong-kham-so-1', 'a'.repeat(30)]) expect(checkTenantCode(ok), ok).toBe('ok');
  });

  it('từ chối sai định dạng', () => {
    for (const bad of ['', 'ab', 'a'.repeat(31), 'Sao-Mai', '-abc', 'abc-', 'a_b', 'sao mai', 'tiếng', 'a.b.c']) expect(checkTenantCode(bad), bad).toBe('format');
  });

  it('từ chối mã dành riêng cho hệ thống', () => {
    for (const reserved of ['admin', 'api', 'www']) expect(checkTenantCode(reserved), reserved).toBe('reserved');
  });
});

describe('normalizeHost', () => {
  it('bỏ cổng, chữ hoa và dấu chấm cuối', () => {
    expect(normalizeHost('SaoMai.NexaMed.vn:443')).toBe('saomai.nexamed.vn');
    expect(normalizeHost('saomai.nexamed.vn.')).toBe('saomai.nexamed.vn');
  });

  it('không nhận IPv6 hoặc rỗng', () => {
    expect(normalizeHost('[::1]:3000')).toBeNull();
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
});

describe('resolveHost', () => {
  it('tên miền phụ hợp lệ → công ty', () => {
    expect(resolveHost('saomai.nexamed.vn', config)).toEqual({ kind: 'tenant', code: 'saomai' });
    expect(resolveHost('saomai.nexamed.vn:8443', config)).toEqual({ kind: 'tenant', code: 'saomai' });
  });

  it('tên miền phụ quản trị → nền tảng', () => {
    expect(resolveHost('admin.nexamed.vn', config)).toEqual({ kind: 'platform' });
  });

  it('không nhận ra: tên miền khác, tên miền gốc trơn, nhiều nhãn, nhãn sai định dạng', () => {
    for (const host of ['nexamed.vn', 'saomai.khac.vn', 'a.b.nexamed.vn', 'xn.nexamed.vn', 'Sao_Mai.nexamed.vn', 'evilnexamed.vn', '.nexamed.vn', undefined]) {
      expect(resolveHost(host, config), String(host)).toEqual({ kind: 'unknown' });
    }
  });

  it('thử nghiệm với localhost', () => {
    expect(resolveHost('saomai.localhost:5173', { baseDomain: 'localhost', adminSubdomain: 'admin' })).toEqual({ kind: 'tenant', code: 'saomai' });
  });
});
