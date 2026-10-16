import { describe, expect, it } from 'vitest';
import { ApiError } from '../../shared/api/client';
import { NETWORK_MESSAGE, RATE_LIMIT_MESSAGE, classifyLoginError, formatCountdown, secondsRemaining } from './login-error';

const NOW = new Date('2026-10-16T10:00:00.000Z');

describe('classifyLoginError', () => {
  it('mất mạng (không phải ApiError) → network', () => {
    expect(classifyLoginError(new TypeError('Failed to fetch'), NOW)).toEqual({ kind: 'network', message: NETWORK_MESSAGE });
  });

  it('sai thông tin → wrong, giữ nguyên câu của máy chủ', () => {
    expect(classifyLoginError(new ApiError('AUTH_INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.'), NOW)).toEqual({
      kind: 'wrong',
      message: 'Sai tên đăng nhập hoặc mật khẩu.',
    });
  });

  it('khoá tạm → locked, đếm theo số giây TƯƠNG ĐỐI máy chủ trả (không dùng đồng hồ máy chủ)', () => {
    const err = new ApiError('AUTH_ACCOUNT_LOCKED', 'x', { retryAfterSeconds: 292, retryAfterMinutes: 5, lockedUntil: '2000-01-01T00:00:00.000Z' });
    const result = classifyLoginError(err, NOW);
    expect(result).toEqual({ kind: 'locked', endsAt: new Date(NOW.getTime() + 292_000), minutes: 5 });
  });

  it('khoá tạm thiếu retryAfterSeconds → dùng retryAfterMinutes, rồi tới lockedUntil', () => {
    const byMinutes = classifyLoginError(new ApiError('AUTH_ACCOUNT_LOCKED', 'x', { retryAfterMinutes: 15 }), NOW);
    expect(byMinutes).toMatchObject({ kind: 'locked', minutes: 15, endsAt: new Date(NOW.getTime() + 900_000) });
    const byUntil = classifyLoginError(new ApiError('AUTH_ACCOUNT_LOCKED', 'x', { lockedUntil: new Date(NOW.getTime() + 60_000).toISOString() }), NOW);
    expect(byUntil).toMatchObject({ kind: 'locked', minutes: 1 });
  });

  it('khoá tạm không có thông tin thời gian → other với câu của máy chủ (không đoán số phút)', () => {
    expect(classifyLoginError(new ApiError('AUTH_ACCOUNT_LOCKED', 'Câu máy chủ'), NOW)).toEqual({ kind: 'other', message: 'Câu máy chủ' });
  });

  it('khoá vĩnh viễn, giới hạn tần suất, công ty tạm ngưng', () => {
    expect(classifyLoginError(new ApiError('AUTH_ACCOUNT_LOCKED_PERMANENT', 'Liên hệ quản trị'), NOW)).toEqual({ kind: 'permanent', message: 'Liên hệ quản trị' });
    expect(classifyLoginError(new ApiError('TOO_MANY_REQUESTS', 'ThrottlerException: Too Many Requests'), NOW)).toEqual({ kind: 'rate', message: RATE_LIMIT_MESSAGE });
    expect(classifyLoginError(new ApiError('TENANT_SUSPENDED', 'Công ty tạm ngưng'), NOW)).toEqual({ kind: 'suspended', message: 'Công ty tạm ngưng' });
  });

  it('lỗi khác → other với câu của máy chủ', () => {
    expect(classifyLoginError(new ApiError('VALIDATION_ERROR', 'Thiếu trường'), NOW)).toEqual({ kind: 'other', message: 'Thiếu trường' });
  });
});

describe('đếm lùi', () => {
  it('formatCountdown dạng mm:ss', () => {
    expect(formatCountdown(292)).toBe('04:52');
    expect(formatCountdown(5)).toBe('00:05');
    expect(formatCountdown(1800)).toBe('30:00');
    expect(formatCountdown(-3)).toBe('00:00');
  });

  it('secondsRemaining làm tròn lên và không âm', () => {
    const end = new Date(NOW.getTime() + 4_200);
    expect(secondsRemaining(end, NOW)).toBe(5);
    expect(secondsRemaining(end, new Date(NOW.getTime() + 10_000))).toBe(0);
  });
});
