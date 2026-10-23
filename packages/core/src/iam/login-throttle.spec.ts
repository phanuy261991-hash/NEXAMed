import { describe, expect, it } from 'vitest';
import { LOGIN_ACCOUNT_LIMIT_PER_MINUTE, LOGIN_IP_LIMIT_SAAS_PER_MINUTE, LOGIN_IP_LIMIT_SINGLE_PER_MINUTE, resolveLoginIpLimit } from './login-throttle';

describe('resolveLoginIpLimit (#258)', () => {
  it('SaaS 30/phút, một công ty 60/phút khi không đặt giá trị riêng', () => {
    expect(resolveLoginIpLimit('saas')).toBe(30);
    expect(resolveLoginIpLimit('single')).toBe(60);
    expect(resolveLoginIpLimit('saas', null)).toBe(LOGIN_IP_LIMIT_SAAS_PER_MINUTE);
    expect(resolveLoginIpLimit('single', undefined)).toBe(LOGIN_IP_LIMIT_SINGLE_PER_MINUTE);
  });

  it('giá trị người vận hành đặt thắng mặc định theo kiểu triển khai', () => {
    expect(resolveLoginIpLimit('saas', 100)).toBe(100);
    expect(resolveLoginIpLimit('single', 5)).toBe(5);
  });

  it('giá trị đặt không hợp lệ (0, âm, số lẻ) → báo lỗi, không lặng lẽ dùng mặc định', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => resolveLoginIpLimit('single', bad), String(bad)).toThrow(RangeError);
  });

  it('trần theo tài khoản là 10/phút và trần IP luôn RỘNG hơn nó ở cả hai kiểu triển khai (IP bị dùng chung nhiều người)', () => {
    expect(LOGIN_ACCOUNT_LIMIT_PER_MINUTE).toBe(10);
    expect(LOGIN_IP_LIMIT_SAAS_PER_MINUTE).toBeGreaterThan(LOGIN_ACCOUNT_LIMIT_PER_MINUTE);
    expect(LOGIN_IP_LIMIT_SINGLE_PER_MINUTE).toBeGreaterThan(LOGIN_IP_LIMIT_SAAS_PER_MINUTE);
  });
});
