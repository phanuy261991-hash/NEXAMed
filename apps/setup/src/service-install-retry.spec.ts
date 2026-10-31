import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerClient } from './lib/docker';
import { getEnvValue, parseEnv } from './lib/env-file';
import { SetupService } from './service';
import { FakeShell, type Handler, psJson } from './testing/fake-shell';

const ENV_EXAMPLE = join(__dirname, '..', '..', '..', 'deploy', 'on-prem', '.env.example');

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-setup-svc-'));
  await mkdir(join(workDir, 'images'));
  for (const n of ['api', 'web', 'backup']) await writeFile(join(workDir, 'images', `nexamed-${n}-0.9.0.tar.gz`), 'x');
  await writeFile(join(workDir, '.env.example'), await readFile(ENV_EXAMPLE, 'utf8'));
});
afterEach(async () => {
  // Tác vụ cài chạy nền vẫn còn ghi file một khoảnh khắc SAU khi báo "xong" nên xoá thư mục tạm đôi khi gặp ENOTEMPTY (test chập chờn ~1/6 lượt, 31/10/2026) — tự thử lại thay vì để test đỏ ngẫu nhiên.
  await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const lan = (webPort: number) => ({
  profile: 'lan' as const,
  lanAddress: '192.168.1.50',
  webPort,
  clinicName: 'Phòng khám Sao Mai',
  adminFullName: 'Trần Thu Hà',
  adminUsername: 'quantri',
  backupDir: 'D:\\NEXAMed-backup',
  backupHourVn: 2,
});

const allHealthy = psJson([{ Service: 'postgres', Health: 'healthy' }, { Service: 'api', Health: 'healthy' }, { Service: 'web' }]);

/** Cổng 8080 bị chương trình khác chiếm: `docker compose up -d` (khởi động cả hệ thống) lỗi chừng nào `.env` còn WEB_HTTP_PORT=8080. */
function portBusyOn8080(): Handler {
  return async (c) => {
    if (!c.args.includes('compose') || c.args.join(' ').includes('up -d postgres') || !c.args.join(' ').endsWith('up -d')) return undefined;
    const envFile = c.args[c.args.indexOf('--env-file') + 1]!;
    const port = getEnvValue(await readFile(envFile, 'utf8'), 'WEB_HTTP_PORT');
    return port === '8080' ? { code: 1, stderr: 'Error response from daemon: ports are not available: exposing port TCP 0.0.0.0:8080' } : undefined;
  };
}

function makeService() {
  const handlers: Handler[] = [
    portBusyOn8080(),
    (c) => (c.line.includes('image inspect') ? { code: 1 } : undefined),
    (c) => (c.line.includes(' ps --all --format json') ? { stdout: allHealthy } : undefined),
    (c) => (c.line.includes('db:seed:pilot-tenant') ? { stdout: 'NEXAMED_RESULT {"tenantId":"11111111-2222-3333-4444-555555555555","username":"quantri","password":null}\n' } : undefined),
  ];
  const shell = new FakeShell(handlers);
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'nexamed-setup:0.9.0' }, async () => undefined);
  const service = new SetupService({ workDir, hostInstallDir: '/c/NEXAMed', hostIps: ['192.168.1.50'], setupVersion: '0.9.0', hostInstallDirDisplay: 'C:\\NEXAMed' }, docker, { sleep: async () => undefined });
  return { service, shell };
}

async function waitSettled(service: SetupService): Promise<string> {
  for (let i = 0; i < 400; i += 1) {
    const state = service.jobView()?.state;
    if (state === 'failed' || state === 'done') return state;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Job không kết thúc');
}

const envPort = async () => getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'WEB_HTTP_PORT');

describe('cài mới: sửa thông tin sau khi lỗi (cổng bị chiếm)', () => {
  it('gửi câu trả lời MỚI (đổi cổng) sau một lần lỗi thì dùng cổng mới, không dùng lại cổng cũ', async () => {
    const { service } = makeService();
    expect(service.startInstall(lan(8080))).toEqual({ ok: true });
    expect(await waitSettled(service)).toBe('failed');
    expect(await envPort()).toBe('8080');
    // Lỗi cổng bị chiếm hiện bằng tiếng Việt kèm cách sửa, không phải nguyên văn lỗi của Docker.
    const error = service.jobView()?.error ?? '';
    expect(error).toMatch(/Cổng web 8080 đang bị chương trình khác/);
    expect(error).toMatch(/Sửa thông tin/);
    expect(error).not.toMatch(/Error response from daemon/);

    expect(service.startInstall(lan(8081))).toEqual({ ok: true });
    expect(await waitSettled(service)).toBe('done');
    expect(await envPort()).toBe('8081');
  });

  it('dựng lại sau lỗi vẫn GIỮ khoá bí mật đã sinh (không đổi mật khẩu cơ sở dữ liệu đã khởi tạo)', async () => {
    const { service } = makeService();
    service.startInstall(lan(8080));
    await waitSettled(service);
    const before = parseEnv(await readFile(join(workDir, '.env'), 'utf8'));
    service.startInstall(lan(8081));
    await waitSettled(service);
    const after = parseEnv(await readFile(join(workDir, '.env'), 'utf8'));
    for (const k of ['POSTGRES_PASSWORD', 'NEXAMED_APP_DB_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY']) expect(after.get(k), k).toBe(before.get(k));
  });

  it('nút "Thử lại" (retry) giữ nguyên câu trả lời cũ — cổng vẫn 8080 nên vẫn lỗi', async () => {
    const { service } = makeService();
    service.startInstall(lan(8080));
    await waitSettled(service);
    expect(service.startInstall({} as never, { retry: true })).toEqual({ ok: true });
    expect(await waitSettled(service)).toBe('failed');
    expect(await envPort()).toBe('8080');
  });

  it('"Thử lại" khi chưa có lần cài nào lỗi → báo không có gì để thử lại, không chạy gì', async () => {
    const { service, shell } = makeService();
    const res = service.startInstall({} as never, { retry: true });
    expect(res.ok).toBe(false);
    expect(shell.calls).toHaveLength(0);
  });
});

describe('mở lại trình cài đặt sau lần cài dở dang', () => {
  it('lần cài lỗi giữa chừng → phiên mới của trình cài đặt KHÔNG coi là "đã cài / bản mới nhất" mà cho cài tiếp', async () => {
    const first = makeService().service;
    first.startInstall(lan(8080));
    expect(await waitSettled(first)).toBe('failed');

    const reopened = makeService().service; // đóng cửa sổ nexamed-setup rồi chạy lại: bộ nhớ mất, chỉ còn file trên đĩa
    const detect = await reopened.detect();
    expect(detect.incompleteInstall).toBe(true);
    expect(detect.mode).toBe('install');
    expect(detect.installedVersion).toBeNull();
    expect(detect.upToDate).toBe(false);
  });

  it('bản cũ chưa có cờ đang-cài: nhận ra lần cài dở nhờ mã phòng khám giữ chỗ trong config.json', async () => {
    await writeFile(join(workDir, '.env'), 'NEXAMED_VERSION=0.9.0\nWEB_HTTP_PORT=8080\n');
    await writeFile(join(workDir, 'config.json'), JSON.stringify({ apiBaseUrl: '', tenantId: '00000000-0000-0000-0000-000000000000' }));
    const detect = await makeService().service.detect();
    expect(detect.incompleteInstall).toBe(true);
    expect(detect.mode).toBe('install');
  });

  it('cài xong trọn vẹn → cờ được xoá, lần mở sau là chế độ nâng cấp (đã cài)', async () => {
    const { service } = makeService();
    service.startInstall(lan(8081));
    expect(await waitSettled(service)).toBe('done');
    const detect = await makeService().service.detect();
    expect(detect.incompleteInstall).toBe(false);
    expect(detect.mode).toBe('upgrade');
    expect(detect.installedVersion).toBe('0.9.0');
  });

  it('hệ thống đã cài từ trước (có phòng khám thật, không có cờ) KHÔNG bị coi là dở dang', async () => {
    await writeFile(join(workDir, '.env'), 'NEXAMED_VERSION=0.9.0\n');
    await writeFile(join(workDir, 'config.json'), JSON.stringify({ apiBaseUrl: '', tenantId: '11111111-2222-3333-4444-555555555555' }));
    const detect = await makeService().service.detect();
    expect(detect.incompleteInstall).toBe(false);
    expect(detect.mode).toBe('upgrade');
  });
});

describe('trạng thái ngay sau khi bấm cài', () => {
  it('chuyển sang "running" NGAY (đồng bộ) — giao diện ngừng hỏi nếu lần hỏi đầu thấy "idle", trang sẽ đứng im dù việc cài vẫn chạy', async () => {
    const { service } = makeService();
    service.startInstall(lan(8081));
    expect(service.jobView()?.state).toBe('running');
    await waitSettled(service);
  });
});
