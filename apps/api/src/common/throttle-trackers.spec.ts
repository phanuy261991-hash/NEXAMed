import { describe, expect, it } from 'vitest';
import { accountTracker, ipTenantTracker, userTracker } from './throttle-trackers';

const T1 = '01a16787-a085-7b74-b23f-0e6798f0c04c';
const T2 = '01a16761-7f2c-7eb8-8ff2-ec3f5e82b3f8';

describe('throttle-trackers (#258)', () => {
  describe('accountTracker — đăng nhập (chưa xác thực)', () => {
    it('cùng công ty + cùng tên đăng nhập → cùng ô đếm, KHÔNG phụ thuộc IP (đổi IP không né được giới hạn tài khoản)', () => {
      const a = accountTracker({ ip: '10.0.0.1', body: { tenantId: T1, username: 'bsA' } });
      const b = accountTracker({ ip: '10.0.0.2', body: { tenantId: T1, username: 'bsA' } });
      expect(a).toBe(b);
    });

    it('tên đăng nhập khác nhau → ô đếm khác (người này không làm người kia bị chặn dù chung IP)', () => {
      const a = accountTracker({ ip: '10.0.0.1', body: { tenantId: T1, username: 'bsA' } });
      const b = accountTracker({ ip: '10.0.0.1', body: { tenantId: T1, username: 'bsB' } });
      expect(a).not.toBe(b);
    });

    it('chuẩn hoá hoa/thường và khoảng trắng; cùng tên ở hai công ty khác nhau là hai ô đếm', () => {
      expect(accountTracker({ body: { tenantId: T1, username: '  BsA ' } })).toBe(accountTracker({ body: { tenantId: T1, username: 'bsa' } }));
      expect(accountTracker({ body: { tenantId: T1, username: 'bsa' } })).not.toBe(accountTracker({ body: { tenantId: T2, username: 'bsa' } }));
    });

    it('tên đăng nhập dài bất thường bị cắt 100 ký tự (không để khoá đếm phình theo chuỗi tuỳ ý)', () => {
      const long = accountTracker({ body: { tenantId: T1, username: 'x'.repeat(5000) } });
      expect(long.length).toBeLessThan(200);
    });

    it('mã công ty rác/không phải UUID → ô đếm chung "khong-xac-dinh"; thiếu tên đăng nhập → rơi về IP + công ty', () => {
      expect(accountTracker({ body: { tenantId: 'rac', username: 'a' } })).toBe('acct|khong-xac-dinh|a');
      expect(accountTracker({ ip: '10.0.0.9', body: { tenantId: T1 } })).toBe(ipTenantTracker({ ip: '10.0.0.9', body: { tenantId: T1 } }));
      expect(accountTracker({ ip: '10.0.0.9', body: undefined })).toContain('ip|10.0.0.9');
    });
  });

  describe('đã xác thực (xin quyền khẩn cấp, tra cứu bệnh nhân)', () => {
    it('theo NGƯỜI DÙNG: hai người cùng IP có hai ô đếm; một người đổi IP vẫn cùng ô đếm', () => {
      const alice = { userId: 'u-alice', tenantId: T1 };
      const bob = { userId: 'u-bob', tenantId: T1 };
      expect(userTracker({ ip: '10.0.0.1', user: alice })).not.toBe(userTracker({ ip: '10.0.0.1', user: bob }));
      expect(userTracker({ ip: '10.0.0.1', user: alice })).toBe(userTracker({ ip: '10.0.0.77', user: alice }));
      expect(accountTracker({ ip: '10.0.0.1', user: alice })).toBe(userTracker({ ip: '10.0.0.1', user: alice }));
    });

    it('cùng userId nhưng công ty khác → ô đếm khác (không va chạm giữa công ty)', () => {
      expect(userTracker({ user: { userId: 'u1', tenantId: T1 } })).not.toBe(userTracker({ user: { userId: 'u1', tenantId: T2 } }));
    });

    it('chưa có người dùng (guard xác thực chưa chạy) → rơi về IP + công ty, vẫn bị giới hạn', () => {
      expect(userTracker({ ip: '10.0.0.5', body: {} })).toBe('ip|10.0.0.5|khong-xac-dinh');
    });
  });

  describe('ipTenantTracker', () => {
    it('theo IP + công ty; thiếu IP vẫn trả khoá cố định (không ném lỗi)', () => {
      expect(ipTenantTracker({ ip: '10.0.0.1', body: { tenantId: T1 } })).toBe(`ip|10.0.0.1|${T1}`);
      expect(ipTenantTracker({ body: { tenantId: T1 } })).toBe(`ip|khong-ro-ip|${T1}`);
    });
  });
});
