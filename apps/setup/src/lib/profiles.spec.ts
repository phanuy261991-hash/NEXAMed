import { describe, expect, it } from 'vitest';
import { type InstallAnswers, backupDirForCompose, buildCaddyfile, buildPlan, utcHourToVn, validateAnswers, vnHourToUtc } from './profiles';

const lan: InstallAnswers = {
  profile: 'lan',
  lanAddress: '192.168.1.50',
  webPort: 80,
  clinicName: 'Phòng khám Đa khoa Sao Mai',
  adminFullName: 'Trần Thu Hà',
  adminUsername: 'quantri',
  backupDir: 'D:\\NEXAMed-backup',
  backupHourVn: 2,
};

describe('giờ sao lưu', () => {
  it('đổi giờ Việt Nam sang UTC và ngược lại', () => {
    expect(vnHourToUtc(2)).toBe(19);
    expect(vnHourToUtc(7)).toBe(0);
    expect(vnHourToUtc(0)).toBe(17);
    expect(vnHourToUtc(23)).toBe(16);
    for (let h = 0; h < 24; h += 1) expect(utcHourToVn(vnHourToUtc(h))).toBe(h);
  });
});

describe('đường dẫn sao lưu cho Compose', () => {
  it('Windows đổi sang dạng /d/..., Linux giữ nguyên', () => {
    expect(backupDirForCompose('D:\\NEXAMed-backup')).toBe('/d/NEXAMed-backup');
    expect(backupDirForCompose('c:\\a\\b\\')).toBe('/c/a/b');
    expect(backupDirForCompose('E:\\')).toBe('/e');
    expect(backupDirForCompose('/mnt/backup/')).toBe('/mnt/backup');
    expect(backupDirForCompose('\\\\nas\\backup')).toBe('//nas/backup');
  });
});

describe('buildPlan', () => {
  it('LAN: HTTP, cổng 80 mở ra mạng nội bộ, không Caddy, tenantId điền sau', () => {
    const plan = buildPlan(lan);
    expect(plan.env).toMatchObject({
      DEPLOYMENT_MODE: 'single',
      WEB_ORIGIN: 'http://192.168.1.50',
      WEB_HTTP_PORT: '80',
      WEB_BIND_IP: '0.0.0.0',
      COOKIE_SECURE: 'false',
      COMPOSE_PROFILES: '',
      BACKUP_HOST_DIR: '/d/NEXAMed-backup',
      BACKUP_DIR_DISPLAY: 'D:\\NEXAMed-backup',
      BACKUP_HOUR: '19',
      BACKUP_RETENTION_DAYS: '14',
    });
    expect(plan.configJson).toEqual({ apiBaseUrl: '' }); // cùng nguồn gốc: IP đổi vẫn chạy
    expect(plan.caddyfile).toBeNull();
    expect(plan.requiredPorts).toEqual([80]);
  });
  it('LAN: cổng 8080 vào địa chỉ; "chỉ trên máy này" gắn 127.0.0.1', () => {
    expect(buildPlan({ ...lan, webPort: 8080 }).env.WEB_ORIGIN).toBe('http://192.168.1.50:8080');
    const local = buildPlan({ ...lan, lanAddress: 'localhost' });
    expect(local.env.WEB_BIND_IP).toBe('127.0.0.1');
    expect(local.publicUrl).toBe('http://localhost');
  });
  it('VPS: HTTPS qua Caddy, web chỉ nghe nội bộ, cookie Secure', () => {
    const plan = buildPlan({ ...lan, profile: 'vps', domain: 'phongkhamsaomai.vn', acmeEmail: 'ha@saomai.vn' });
    expect(plan.env).toMatchObject({ DEPLOYMENT_MODE: 'single', WEB_ORIGIN: 'https://phongkhamsaomai.vn', WEB_BIND_IP: '127.0.0.1', WEB_HTTP_PORT: '8081', COOKIE_SECURE: 'true', COMPOSE_PROFILES: 'https' });
    expect(plan.caddyfile).toContain('email ha@saomai.vn');
    expect(plan.caddyfile).toContain('phongkhamsaomai.vn {');
    expect(plan.caddyfile).toContain('reverse_proxy web:80');
    expect(plan.configJson).toEqual({ apiBaseUrl: '' });
    expect(plan.requiredPorts).toEqual([80, 443]);
  });
  it('SaaS: chế độ saas, config.json KHÔNG có tenantId, Caddy dùng chứng chỉ wildcard', () => {
    const plan = buildPlan({
      profile: 'saas',
      domain: 'nexamed.vn',
      operatorFullName: 'Nguyễn Minh Tuấn',
      operatorUsername: 'vanhanh',
      operatorPassword: 'Vanhanh@2026!',
      backupDir: '/srv/nexamed-backup',
      backupHourVn: 3,
      backupRetentionDays: 30,
    });
    expect(plan.env).toMatchObject({ DEPLOYMENT_MODE: 'saas', PLATFORM_BASE_DOMAIN: 'nexamed.vn', PLATFORM_ADMIN_SUBDOMAIN: 'admin', WEB_ORIGIN: 'https://admin.nexamed.vn', COOKIE_SECURE: 'true', COMPOSE_PROFILES: 'https', BACKUP_HOUR: '20', BACKUP_RETENTION_DAYS: '30' });
    expect(plan.configJson).toEqual({ apiBaseUrl: '' });
    expect('tenantId' in plan.configJson).toBe(false);
    expect(plan.caddyfile).toContain('https://*.nexamed.vn, https://nexamed.vn {');
    expect(plan.caddyfile).toContain('tls /certs/fullchain.crt /certs/privkey.key');
    expect(plan.summary.map((r) => r[0])).toContain('Người vận hành');
    expect(plan.summary.flat().join(' ')).not.toContain('Vanhanh@2026!');
  });
  it('Caddyfile VPS không có khối tls thủ công (Caddy tự xin chứng chỉ)', () => {
    expect(buildCaddyfile('vps', 'a.vn', 'x@a.vn')).not.toContain('tls ');
  });
  it('Caddyfile VPS và SaaS có trang báo tiếng Việt khi không nối được tới web (không để lộ "Bad Gateway" thô, #255)', () => {
    for (const file of [buildCaddyfile('vps', 'a.vn', 'x@a.vn'), buildCaddyfile('saas', 'a.vn')]) {
      expect(file).toContain('handle_errors');
      expect(file).toContain('Hệ thống tạm thời không truy cập được');
      expect(file).toMatch(/respond `[^`]+` 503/);
      expect(file.indexOf('reverse_proxy')).toBeLessThan(file.indexOf('handle_errors'));
    }
  });
  it('Caddyfile VPS và SaaS đều gửi HSTS 180 ngày, chưa includeSubDomains/preload (#252)', () => {
    for (const file of [buildCaddyfile('vps', 'a.vn', 'x@a.vn'), buildCaddyfile('saas', 'a.vn')]) {
      expect(file).toContain('header Strict-Transport-Security "max-age=15552000"');
      expect(file).not.toMatch(/includeSubDomains|preload/i);
      expect(file.indexOf('Strict-Transport-Security')).toBeLessThan(file.indexOf('reverse_proxy'));
    }
  });
});

describe('validateAnswers', () => {
  it('chuẩn hoá và chấp nhận câu trả lời LAN hợp lệ', () => {
    const checked = validateAnswers({ ...lan, adminUsername: ' quantri ', clinicName: '  Phòng khám   Sao Mai ' });
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.value.adminUsername).toBe('quantri');
      expect(checked.value.clinicName).toBe('Phòng khám Sao Mai');
      expect(checked.value.backupRetentionDays).toBe(14);
    }
  });
  it('gom lỗi theo từng ô', () => {
    const checked = validateAnswers({ ...lan, lanAddress: '999.1.1.1', webPort: 0, adminUsername: 'a', backupDir: 'abc', backupHourVn: 30 });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(Object.keys(checked.errors).sort()).toEqual(['adminUsername', 'backupDir', 'backupHourVn', 'lanAddress', 'webPort']);
  });
  it('không có kiểu triển khai thì báo lỗi', () => {
    expect(validateAnswers({} as never)).toEqual({ ok: false, errors: { profile: 'Chọn kiểu triển khai.' } });
  });
  it('VPS cần tên miền và email; SaaS cần mật khẩu mạnh và khớp', () => {
    const vps = validateAnswers({ ...lan, profile: 'vps', domain: 'https://x.vn', acmeEmail: 'bad' });
    expect(vps.ok).toBe(false);
    if (!vps.ok) expect(Object.keys(vps.errors)).toEqual(expect.arrayContaining(['domain', 'acmeEmail']));
    const base = { profile: 'saas' as const, domain: 'nexamed.vn', operatorFullName: 'A B', operatorUsername: 'vanhanh', backupDir: '/srv/b', backupHourVn: 2 };
    const weak = validateAnswers({ ...base, operatorPassword: 'yeu', operatorPasswordConfirm: 'yeu' });
    expect(weak.ok).toBe(false);
    const mismatch = validateAnswers({ ...base, operatorPassword: 'Vanhanh@2026!', operatorPasswordConfirm: 'Khac@2026!!' });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.errors.operatorPasswordConfirm).toBeDefined();
    expect(validateAnswers({ ...base, operatorPassword: 'Vanhanh@2026!', operatorPasswordConfirm: 'Vanhanh@2026!' }).ok).toBe(true);
  });
  it('số ngày giữ bản sao ngoài 1–365 bị từ chối', () => {
    expect(validateAnswers({ ...lan, backupRetentionDays: 0 }).ok).toBe(false);
    expect(validateAnswers({ ...lan, backupRetentionDays: 366 }).ok).toBe(false);
  });
});
