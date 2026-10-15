import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeShell, type Handler, psJson } from '../testing/fake-shell';
import { DockerClient } from './docker';
import { getEnvValue, parseEnv } from './env-file';
import { type InstallResult, buildInstallSteps, parseSeedResult } from './install';
import { Job } from './job';
import type { InstallAnswers } from './profiles';

const ENV_EXAMPLE = join(__dirname, '..', '..', '..', '..', 'deploy', 'on-prem', '.env.example');

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-setup-'));
  await mkdir(join(workDir, 'images'));
  for (const n of ['api', 'web', 'backup']) await writeFile(join(workDir, 'images', `nexamed-${n}-0.9.0.tar.gz`), 'x');
  await writeFile(join(workDir, 'images', 'third-party-caddy.tar.gz'), 'x');
  await writeFile(join(workDir, '.env.example'), await readFile(ENV_EXAMPLE, 'utf8'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const lan: InstallAnswers = {
  profile: 'lan',
  lanAddress: '192.168.1.50',
  webPort: 80,
  clinicName: 'Phòng khám Sao Mai',
  adminFullName: 'Trần Thu Hà',
  adminUsername: 'quantri',
  backupDir: 'D:\\NEXAMed-backup',
  backupHourVn: 2,
};

const allHealthy = psJson([
  { Service: 'postgres', Health: 'healthy' },
  { Service: 'api', Health: 'healthy' },
  { Service: 'web' },
  { Service: 'caddy' },
]);

function baseHandlers(extra: Handler[] = []): Handler[] {
  return [
    ...extra,
    (c) => (c.line.includes('image inspect') ? { code: 1 } : undefined),
    (c) => (c.line.includes(' ps --all --format json') ? { stdout: allHealthy } : undefined),
    (c) => (c.line.includes('db:seed:pilot-tenant') ? { stdout: 'x\nNEXAMED_RESULT {"tenantId":"11111111-2222-3333-4444-555555555555","username":"quantri","password":null}\n' } : undefined),
    (c) => (c.line.includes('db:seed:platform-operator') ? { stdout: 'NEXAMED_RESULT {"username":"vanhanh","password":null,"totpSecret":"X"}\n' } : undefined),
  ];
}

function setup(answers: InstallAnswers, handlers: Handler[] = [], deps: Partial<Parameters<typeof buildInstallSteps>[1]> = {}) {
  const shell = new FakeShell(baseHandlers(handlers));
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'nexamed-setup:0.9.0' }, async () => undefined);
  const state: { result?: InstallResult } = {};
  let n = 0;
  const steps = buildInstallSteps(
    answers,
    { docker, workDir, version: '0.9.0', random: { hex: (b) => `${'ab'.repeat(b)}`.slice(0, b * 2) + String(n++), tempPassword: () => '7KqV-mT2x-Pa9n' }, sleep: async () => undefined, ...deps },
    state,
  );
  return { shell, state, job: new Job(steps) };
}

describe('cài mới kiểu LAN', () => {
  it('chạy đủ các bước theo thứ tự, ghi .env/config.json và trả kết quả', async () => {
    const { shell, state, job } = setup(lan);
    await job.run();
    const view = job.view();
    expect(view.error).toBeNull();
    expect(view.state).toBe('done');
    expect(view.steps.map((s) => s.id)).toEqual(['images', 'config', 'database', 'app', 'health', 'clinic']);

    const loaded = shell.calls.filter((c) => c.args[0] === 'load').map((c) => c.args[2]!.replace(/\\/g, '/').split('/').pop());
    expect(loaded).toEqual(['nexamed-api-0.9.0.tar.gz', 'nexamed-web-0.9.0.tar.gz', 'nexamed-backup-0.9.0.tar.gz']); // LAN không nạp Caddy

    const compose = shell.composeCalls();
    expect(compose.indexOf('up -d postgres')).toBeLessThan(compose.indexOf('up -d'));
    expect(compose.findIndex((l) => l.includes('db:seed:pilot-tenant'))).toBeGreaterThan(compose.indexOf('up -d'));

    const env = parseEnv(await readFile(join(workDir, '.env'), 'utf8'));
    expect(env.get('NEXAMED_VERSION')).toBe('0.9.0');
    expect(env.get('WEB_ORIGIN')).toBe('http://192.168.1.50');
    expect(env.get('BACKUP_HOST_DIR')).toBe('/d/NEXAMed-backup');
    expect(env.get('DEPLOYMENT_MODE')).toBe('single');
    for (const k of ['POSTGRES_PASSWORD', 'NEXAMED_APP_DB_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY']) expect(env.get(k), k).toMatch(/^[0-9a-f]{20,}\d*$/);
    expect(env.get('ENCRYPTION_KEY')!.length).toBeGreaterThanOrEqual(32);

    const config = JSON.parse(await readFile(join(workDir, 'config.json'), 'utf8'));
    expect(config).toEqual({ apiBaseUrl: '', tenantId: '11111111-2222-3333-4444-555555555555' });

    expect(state.result).toMatchObject({ profile: 'lan', username: 'quantri', tempPassword: '7KqV-mT2x-Pa9n', tenantId: '11111111-2222-3333-4444-555555555555', publicUrl: 'http://192.168.1.50' });
  });

  it('mật khẩu tạm truyền qua biến môi trường của tiến trình con, KHÔNG nằm trên dòng lệnh hay nhật ký', async () => {
    const { shell, job } = setup(lan);
    await job.run();
    const seed = shell.calls.find((c) => c.line.includes('db:seed:pilot-tenant'))!;
    expect(seed.line).not.toContain('7KqV-mT2x-Pa9n');
    expect(seed.options?.env?.ADMIN_PASSWORD).toBe('7KqV-mT2x-Pa9n');
    expect(job.view().log.join('\n')).not.toContain('7KqV-mT2x-Pa9n');
  });

  it('chạy lại không sinh lại khoá hệ thống đã có', async () => {
    const first = setup(lan);
    await first.job.run();
    const before = await readFile(join(workDir, '.env'), 'utf8');
    const second = setup({ ...lan, backupHourVn: 3 }, [], { random: { hex: () => 'KHAC', tempPassword: () => 'x' } });
    await second.job.run().catch(() => undefined);
    const after = parseEnv(await readFile(join(workDir, '.env'), 'utf8'));
    expect(after.get('JWT_SECRET')).toBe(getEnvValue(before, 'JWT_SECRET'));
    expect(after.get('ENCRYPTION_KEY')).toBe(getEnvValue(before, 'ENCRYPTION_KEY'));
    expect(after.get('BACKUP_HOUR')).toBe('20'); // giá trị mới do người cài đổi vẫn được áp
  });

  it('bỏ qua nạp ảnh đã có sẵn trên máy', async () => {
    const { shell, job } = setup(lan, [(c) => (c.line.includes('image inspect') ? { code: 0, stdout: 'sha' } : undefined)]);
    await job.run();
    expect(shell.calls.some((c) => c.args[0] === 'load')).toBe(false);
  });

  it('thiếu file ảnh thì dừng ở bước đầu với thông báo rõ ràng', async () => {
    await rm(join(workDir, 'images', 'nexamed-web-0.9.0.tar.gz'));
    const { job } = setup(lan);
    await job.run();
    expect(job.view().state).toBe('failed');
    expect(job.view().steps[0]!.status).toBe('bad');
    expect(job.view().error).toContain('đủ 3 file ảnh');
  });

  it('Thử lại tiếp tục từ bước lỗi, không làm lại bước đã xong', async () => {
    let fail = true;
    const { shell, job } = setup(lan, [(c) => (c.line.includes(' up -d postgres') && fail ? { code: 1, stderr: 'port in use' } : undefined)]);
    await job.run();
    expect(job.view().steps.map((s) => s.status)).toEqual(['ok', 'ok', 'bad', 'wait', 'wait', 'wait']);
    fail = false;
    const loadsBefore = shell.calls.filter((c) => c.args[0] === 'load').length;
    await job.run();
    expect(job.view().state).toBe('done');
    expect(shell.calls.filter((c) => c.args[0] === 'load').length).toBe(loadsBefore);
  });

  it('cơ sở dữ liệu không healthy thì báo lỗi', async () => {
    const { job } = setup(lan, [(c) => (c.line.includes(' ps --all --format json') ? { stdout: psJson([{ Service: 'postgres', State: 'exited' }]) } : undefined)]);
    await job.run();
    expect(job.view().error).toContain('Cơ sở dữ liệu không báo sẵn sàng');
  });

  it('phòng khám trùng tên (cài lại) có thông báo hướng dẫn', async () => {
    const { job } = setup(lan, [(c) => (c.line.includes('db:seed:pilot-tenant') ? { code: 1, stderr: '✗ Tạo tenant pilot thất bại: Đã tồn tại tenant tên "x"' } : undefined)]);
    await job.run();
    expect(job.view().error).toContain('đã được tạo ở lần cài trước');
  });
});

describe('cài mới kiểu VPS', () => {
  const vps: InstallAnswers = { ...lan, profile: 'vps', domain: 'phongkhamsaomai.vn', acmeEmail: 'ha@saomai.vn' };

  it('thêm bước xin chứng chỉ, ghi Caddyfile, nạp ảnh Caddy', async () => {
    const { shell, job } = setup(vps, [(c) => (c.line.includes(' logs ') && c.line.includes('caddy') ? { stdout: 'certificate obtained successfully' } : undefined)]);
    await job.run();
    expect(job.view().error).toBeNull();
    expect(job.view().steps.map((s) => s.id)).toEqual(['images', 'config', 'database', 'app', 'https', 'health', 'clinic']);
    expect(await readFile(join(workDir, 'Caddyfile'), 'utf8')).toContain('phongkhamsaomai.vn {');
    expect(shell.calls.some((c) => c.args[0] === 'load' && c.args[2]!.includes('third-party-caddy'))).toBe(true);
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'COMPOSE_PROFILES')).toBe('https');
  });

  it('không xin được chứng chỉ thì báo lỗi kèm gợi ý DNS/cổng', async () => {
    let t = 0;
    const clock = Date.now;
    Date.now = () => (t += 100_000); // thu ngắn thời hạn chờ để test không phải đợi thật
    try {
      const { job } = setup(vps, [(c) => (c.line.includes(' logs ') ? { stdout: 'acme: error' } : undefined)]);
      await job.run();
      expect(job.view().error).toContain('Chưa xin được chứng chỉ HTTPS');
      expect(job.view().error).toContain('cổng 80, 443');
    } finally {
      Date.now = clock;
    }
  });
});

describe('cài mới kiểu SaaS', () => {
  const saas: InstallAnswers = {
    profile: 'saas',
    domain: 'nexamed.vn',
    operatorFullName: 'Nguyễn Minh Tuấn',
    operatorUsername: 'vanhanh',
    operatorPassword: 'Vanhanh@2026!',
    backupDir: '/srv/b',
    backupHourVn: 2,
  };

  it('tạo người vận hành với bí mật OTP sinh sẵn; không tạo phòng khám; config không có tenantId; chứng chỉ được ghi', async () => {
    const { shell, state, job } = setup(saas, [], { cert: { crt: 'CRT', key: 'KEY' }, operatorTotpSecret: 'JBSWY3DPEHPK3PXP' });
    await job.run();
    expect(job.view().error).toBeNull();
    expect(job.view().steps.map((s) => s.id)).toEqual(['images', 'config', 'database', 'app', 'https', 'health', 'operator']);
    const seed = shell.calls.find((c) => c.line.includes('db:seed:platform-operator'))!;
    expect(seed.options?.env).toMatchObject({ OPERATOR_USERNAME: 'vanhanh', OPERATOR_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', OPERATOR_PASSWORD: 'Vanhanh@2026!' });
    expect(seed.line).not.toContain('Vanhanh@2026!');
    expect(shell.calls.some((c) => c.line.includes('db:seed:pilot-tenant'))).toBe(false);
    expect(JSON.parse(await readFile(join(workDir, 'config.json'), 'utf8'))).toEqual({ apiBaseUrl: '' });
    expect(await readFile(join(workDir, 'certs', 'fullchain.crt'), 'utf8')).toBe('CRT');
    expect(state.result).toMatchObject({ profile: 'saas', username: 'vanhanh', totpSecret: 'JBSWY3DPEHPK3PXP' });
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'PLATFORM_BASE_DOMAIN')).toBe('nexamed.vn');
  });

  it('Caddy không chạy (chứng chỉ hỏng) thì dừng ở bước HTTPS', async () => {
    const { job } = setup(saas, [(c) => (c.line.includes(' ps --all --format json') ? { stdout: psJson([{ Service: 'postgres', Health: 'healthy' }, { Service: 'caddy', State: 'exited' }]) } : undefined)], { cert: { crt: 'CRT', key: 'KEY' } });
    await job.run();
    expect(job.view().steps.find((s) => s.id === 'https')!.status).toBe('bad');
  });
});

describe('parseSeedResult', () => {
  it('đọc dòng NEXAMED_RESULT giữa các dòng khác', () => {
    expect(parseSeedResult<{ a: number }>('hello\nNEXAMED_RESULT {"a":1}\nbye')).toEqual({ a: 1 });
  });
  it('báo lỗi khi không có dòng kết quả', () => {
    expect(() => parseSeedResult('chỉ có log')).toThrow('Không đọc được kết quả');
  });
});

describe('Job', () => {
  it('lọc dòng nhật ký có thể chứa bí mật', async () => {
    const job = new Job([{ id: 'a', title: 'a', detail: '', run: async (ctx) => { ctx.log('Mật khẩu: abc'); ctx.log('NEXAMED_RESULT {}'); ctx.log('Bí mật OTP: X'); ctx.log('bình thường'); } }]);
    await job.run();
    expect(job.view().log).toEqual(['bình thường']);
  });
});
