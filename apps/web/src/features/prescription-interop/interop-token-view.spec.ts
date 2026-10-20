import { describe, expect, it } from 'vitest';
import type { InteropTokenState } from '@nexamed/shared';
import { describeDoctorToken, describeFacilityToken } from './interop-token-view';

const DAY = 86_400_000;
const none: InteropTokenState = { status: 'NONE', issuedAt: null, expiresAt: null, remainingMs: 0 };
// 14/10/2026 05:50 UTC = 12:50 giờ Việt Nam
const issued = '2026-10-14T05:50:00.000Z';
const state = (status: InteropTokenState['status'], remainingMs: number): InteropTokenState => ({ status, issuedAt: issued, expiresAt: new Date(new Date(issued).getTime() + 7 * DAY).toISOString(), remainingMs });

describe('describeFacilityToken', () => {
  it('chưa nhập mã/mật khẩu → "Chưa cấu hình", không dòng token', () => {
    expect(describeFacilityToken(none, false)).toEqual({ primary: null, secondary: null, badge: { tone: 'neutral', label: 'Chưa cấu hình' } });
  });

  it('đã nhập nhưng chưa đăng nhập lần nào → "Chưa đăng nhập"', () => {
    expect(describeFacilityToken(none, true).badge).toEqual({ tone: 'neutral', label: 'Chưa đăng nhập' });
    expect(describeFacilityToken(none, true).primary).toBeNull();
  });

  it('còn hạn: giờ đăng nhập theo giờ Việt Nam, hạn dự kiến +7 ngày, badge xanh', () => {
    const v = describeFacilityToken(state('VALID', 6 * DAY), true);
    expect(v.primary).toBe('Đăng nhập 14/10 12:50');
    expect(v.secondary).toBe('hết hạn dự kiến 21/10 (7 ngày)');
    expect(v.badge).toEqual({ tone: 'success', label: 'Còn hạn' });
  });

  it('sắp hết hạn → vàng; hết hạn → đỏ', () => {
    expect(describeFacilityToken(state('EXPIRING', 3600_000), true).badge).toEqual({ tone: 'warning', label: 'Sắp hết hạn' });
    expect(describeFacilityToken(state('EXPIRED', 0), true).badge).toEqual({ tone: 'danger', label: 'Hết hạn' });
  });

  it('KHÔNG bao giờ chứa chữ token thật (chỉ nhãn tiếng Việt)', () => {
    const v = describeFacilityToken(state('VALID', DAY), true);
    expect(JSON.stringify(v)).not.toMatch(/eyJ|bearer/i);
  });
});

describe('describeDoctorToken', () => {
  it('các trạng thái', () => {
    expect(describeDoctorToken(none)).toBe('—');
    expect(describeDoctorToken(state('VALID', 6.2 * DAY))).toBe('còn khoảng 6 ngày');
    expect(describeDoctorToken(state('VALID', 1.4 * DAY))).toBe('còn khoảng 1 ngày');
    expect(describeDoctorToken(state('EXPIRING', 0.5 * DAY))).toBe('còn dưới 1 ngày');
    expect(describeDoctorToken(state('EXPIRED', 0))).toBe('đã hết hạn');
  });
});
