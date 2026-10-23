import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { DEVICE_COOKIE_MAX_AGE_MS, DeviceTrustService } from './device-trust.service';

const config = (secret: string) => ({ getOrThrow: () => secret }) as unknown as ConfigService<never, true>;
const svc = (secret = 'bi-mat-jwt-dung-cho-test-1234567890') => new DeviceTrustService(config(secret) as never);

const T = '01a16787-a085-7b74-b23f-0e6798f0c04c';
const alice = { id: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', passwordHash: '$argon2id$hash-cua-alice' };
const bob = { id: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', passwordHash: '$argon2id$hash-cua-bob' };
const NOW = new Date('2026-10-23T08:00:00.000Z');

function cookiesOf(c: { name: string; value: string }): Record<string, string> {
  return { [c.name]: c.value };
}

describe('DeviceTrustService (#259)', () => {
  it('cookie vừa cấp cho chính tài khoản đó → máy quen', () => {
    const s = svc();
    const cookie = s.issue(T, alice, NOW);
    expect(cookie.name).toBe('nx_dev_0198a1b2c3d47e5f8a9b0c1d2e3f4a5b');
    expect(cookie.maxAgeMs).toBe(DEVICE_COOKIE_MAX_AGE_MS);
    expect(s.isFamiliar(cookiesOf(cookie), T, alice, NOW)).toBe(true);
  });

  it('không có cookie / cookie rác / sai định dạng → máy lạ (không bao giờ ném lỗi)', () => {
    const s = svc();
    const name = s.cookieName(alice.id);
    expect(s.isFamiliar(undefined, T, alice, NOW)).toBe(false);
    expect(s.isFamiliar({}, T, alice, NOW)).toBe(false);
    for (const junk of ['', 'abc', 'v1.123.xxx', 'v2.1.' + 'A'.repeat(43), 'v1.99999999999999.' + 'A'.repeat(43), `v1.${Math.floor(NOW.getTime() / 1000)}.${'A'.repeat(43)}`]) {
      expect(s.isFamiliar({ [name]: junk }, T, alice, NOW), junk).toBe(false);
    }
  });

  it('cookie của NGƯỜI KHÁC không dùng được cho tài khoản này (kể cả đổi tên cookie)', () => {
    const s = svc();
    const bobCookie = s.issue(T, bob, NOW);
    expect(s.isFamiliar(cookiesOf(bobCookie), T, alice, NOW)).toBe(false);
    expect(s.isFamiliar({ [s.cookieName(alice.id)]: bobCookie.value }, T, alice, NOW)).toBe(false);
  });

  it('cùng tài khoản nhưng KHÁC công ty → không phải máy quen', () => {
    const s = svc();
    const cookie = s.issue(T, alice, NOW);
    expect(s.isFamiliar(cookiesOf(cookie), '01a16761-7f2c-7eb8-8ff2-ec3f5e82b3f8', alice, NOW)).toBe(false);
  });

  it('ĐỔI MẬT KHẨU (hoặc quản trị đặt lại) → máy quen cũ mất hiệu lực', () => {
    const s = svc();
    const cookie = s.issue(T, alice, NOW);
    expect(s.isFamiliar(cookiesOf(cookie), T, { ...alice, passwordHash: '$argon2id$mat-khau-moi' }, NOW)).toBe(false);
  });

  it('đổi khoá bí mật (JWT_SECRET) → mọi dấu hiệu cũ mất hiệu lực; giả mạo bằng khoá khác không qua', () => {
    const cookie = svc('khoa-bi-mat-cu-0123456789abcdef').issue(T, alice, NOW);
    expect(svc('khoa-bi-mat-moi-0123456789abcdef').isFamiliar(cookiesOf(cookie), T, alice, NOW)).toBe(false);
  });

  it('sửa dấu thời gian trong cookie để kéo dài hạn → chữ ký sai, không qua', () => {
    const s = svc();
    const cookie = s.issue(T, alice, NOW);
    const [v, , mac] = cookie.value.split('.');
    const forged = `${v}.${Math.floor(NOW.getTime() / 1000) + 5}.${mac}`;
    expect(s.isFamiliar({ [cookie.name]: forged }, T, alice, new Date(NOW.getTime() + 10_000))).toBe(false);
  });

  it('hết hạn sau 180 ngày; còn hạn ở ngày 179', () => {
    const s = svc();
    const cookie = s.issue(T, alice, NOW);
    const day = 24 * 60 * 60_000;
    expect(s.isFamiliar(cookiesOf(cookie), T, alice, new Date(NOW.getTime() + 179 * day))).toBe(true);
    expect(s.isFamiliar(cookiesOf(cookie), T, alice, new Date(NOW.getTime() + 181 * day))).toBe(false);
  });

  it('cookie cấp "trong tương lai" quá xa (đồng hồ bị chỉnh) bị từ chối; lệch nhẹ ≤ 60 giây thì chấp nhận', () => {
    const s = svc();
    const future = s.issue(T, alice, new Date(NOW.getTime() + 10 * 60_000));
    expect(s.isFamiliar(cookiesOf(future), T, alice, NOW)).toBe(false);
    const slight = s.issue(T, alice, new Date(NOW.getTime() + 30_000));
    expect(s.isFamiliar(cookiesOf(slight), T, alice, NOW)).toBe(true);
  });
});
