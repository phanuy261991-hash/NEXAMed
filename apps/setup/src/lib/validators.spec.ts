import { describe, expect, it } from 'vitest';
import { assessPassword, validateBackupDir, validateDomain, validateEmail, validateHour, validateLanAddress, validatePort, validateRequiredText, validateUsername } from './validators';

describe('validators', () => {
  it('tên miền: chuẩn hoá và từ chối giao thức/cổng/đường dẫn', () => {
    expect(validateDomain(' PhongKham.VN. ')).toEqual({ ok: true, value: 'phongkham.vn' });
    for (const bad of ['', 'localhost', 'https://a.vn', 'a.vn:443', 'a.vn/x', '-a.vn', 'a_b.vn', 'a.123']) {
      expect(validateDomain(bad).ok, bad).toBe(false);
    }
  });
  it('email, họ tên, tên đăng nhập', () => {
    expect(validateEmail('ha@saomai.vn').ok).toBe(true);
    expect(validateEmail('ha@saomai').ok).toBe(false);
    expect(validateRequiredText('  Trần   Thu Hà ', 'họ tên')).toEqual({ ok: true, value: 'Trần Thu Hà' });
    expect(validateRequiredText('   ', 'họ tên').ok).toBe(false);
    expect(validateUsername('quan.tri_1').ok).toBe(true);
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('có dấu').ok).toBe(false);
  });
  it('độ mạnh mật khẩu: chỉ chấp nhận ≥12 ký tự, ≥3 loại, không từ thông dụng', () => {
    expect(assessPassword('Vanhanh@2026!').acceptable).toBe(true);
    expect(assessPassword('short1A!').acceptable).toBe(false);
    expect(assessPassword('chuthuongchuthuong').acceptable).toBe(false);
    expect(assessPassword('Password@12345').acceptable).toBe(false);
    expect(assessPassword('aaaaaaaaaaaaaaaa').score).toBe(0);
    expect(assessPassword('').score).toBe(0);
  });
  it('cổng, địa chỉ LAN, thư mục sao lưu, giờ', () => {
    expect(validatePort('8080')).toEqual({ ok: true, value: 8080 });
    expect(validatePort(0).ok).toBe(false);
    expect(validatePort('abc').ok).toBe(false);
    expect(validateLanAddress('192.168.1.50').ok).toBe(true);
    expect(validateLanAddress('LOCALHOST')).toEqual({ ok: true, value: 'localhost' });
    expect(validateLanAddress('300.1.1.1').ok).toBe(false);
    expect(validateBackupDir('D:\\NEXAMed-backup').ok).toBe(true);
    expect(validateBackupDir('\\\\nas\\backup').ok).toBe(true);
    expect(validateBackupDir('/srv/backup').ok).toBe(true);
    expect(validateBackupDir('backup').ok).toBe(false);
    expect(validateBackupDir('D:\\a|b').ok).toBe(false);
    expect(validateHour(23).ok).toBe(true);
    expect(validateHour(24).ok).toBe(false);
  });
});
