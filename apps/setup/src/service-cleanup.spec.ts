import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerClient } from './lib/docker';
import { SetupService } from './service';
import { FakeShell, psJson } from './testing/fake-shell';

/** Dọn gói cũ ở tầng dịch vụ (docs/DECISIONS.md #301): máy chủ tự tính lại kế hoạch, không tin danh sách giao diện gửi lên. */

const REPOS = ['api', 'web', 'backup', 'setup'];
const VERSIONS = ['0.9.0', '0.9.1', '0.9.5', '0.9.6'];

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-svc-clean-'));
  await mkdir(join(workDir, 'images'));
  for (const v of VERSIONS) for (const r of REPOS) await writeFile(join(workDir, 'images', `nexamed-${r}-${v}.tar.gz`), 'x'.repeat(10));
  await writeFile(join(workDir, 'VERSION'), '0.9.6');
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeService(containers: Array<[string, string]> = []) {
  // Kho ảnh Docker giả CÓ trạng thái: `image rm` làm ảnh biến mất khỏi lần liệt kê sau.
  const images = new Set(VERSIONS.flatMap((v) => REPOS.map((r) => `nexamed-${r} ${v}`)));
  const shell = new FakeShell([
    (c) => (c.line.includes(' ps --all --format json') ? { stdout: psJson([{ Service: 'api', Health: 'healthy' }]) } : undefined),
    (c) => (c.args[0] === 'ps' ? { stdout: containers.map(([name, image]) => `${name} ${image}`).join('\n') } : undefined),
    (c) => (c.line.includes('image ls') ? { stdout: [...images].join('\n') } : undefined),
    (c) => (c.args[0] === 'image' && c.args[1] === 'rm' ? (images.delete(String(c.args[2]).replace(':', ' ')), {}) : undefined),
  ]);
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'nexamed-setup:0.9.6' }, async () => undefined);
  const service = new SetupService({ workDir, hostInstallDir: '/c/NEXAMed', hostIps: ['192.168.1.50'], setupVersion: '0.9.6', hostInstallDirDisplay: 'C:\\NEXAMed' }, docker, { sleep: async () => undefined });
  return { service, shell };
}

async function installedAt(version: string, lastUpgrade?: { from: string; to: string }) {
  await writeFile(join(workDir, '.env'), `NEXAMED_VERSION=${version}\nWEB_HTTP_PORT=8080\n`);
  await writeFile(join(workDir, 'config.json'), JSON.stringify({ apiBaseUrl: '', tenantId: '11111111-2222-3333-4444-555555555555' }));
  if (lastUpgrade) await writeFile(join(workDir, '.setup-state.json'), JSON.stringify({ lastUpgrade: { ...lastUpgrade, backupFile: 'x.dump', at: '2026-11-17T00:00:00Z' } }));
}

async function waitJob(service: SetupService) {
  while (service.jobView()?.state === 'running') await new Promise((r) => setTimeout(r, 5));
}

describe('SetupService — dọn gói cũ', () => {
  it('chưa cài hệ thống: không có danh sách và không dọn được', async () => {
    const { service } = makeService();
    expect(await service.cleanupView()).toBeNull();
    expect(await service.beginCleanup(['0.9.0'])).toMatchObject({ ok: false });
  });

  it('bản trước lấy theo lần nâng cấp gần nhất, không theo số nhỏ hơn liền kề', async () => {
    await installedAt('0.9.6', { from: '0.9.1', to: '0.9.6' });
    const view = await makeService().service.cleanupView();
    expect(view?.keep).toEqual({ installed: '0.9.6', packageVersion: '0.9.6', previous: '0.9.1' });
    expect(view?.rows.find((r) => r.version === '0.9.1')?.action).toBe('previous');
    expect(view?.cleanVersions).toEqual(['0.9.5', '0.9.0']);
  });

  it('chưa nâng cấp lần nào (hoặc đã quay lui): không có bản trước, các bản còn lại đều dọn được', async () => {
    await installedAt('0.9.6');
    expect((await makeService().service.cleanupView())?.cleanVersions).toEqual(['0.9.5', '0.9.1', '0.9.0']);
  });

  it('từ chối: danh sách rỗng, bản đang giữ, bản không có trong kế hoạch; không xoá gì', async () => {
    await installedAt('0.9.6', { from: '0.9.5', to: '0.9.6' });
    const { service, shell } = makeService();
    expect(await service.beginCleanup([])).toEqual({ ok: false, error: 'Chưa chọn bản nào để dọn.' });
    for (const bad of [['0.9.6'], ['0.9.5'], ['0.9.0', '0.9.5'], ['1.2.3'], ['../../etc']]) {
      expect(await service.beginCleanup(bad)).toMatchObject({ ok: false });
    }
    expect(await readdir(join(workDir, 'images'))).toHaveLength(16); // 4 bản × 4 ảnh, không tệp nào bị xoá
    expect(shell.calls.some((c) => c.args[1] === 'rm')).toBe(false);
    expect(service.jobView()).toBeNull();
  });

  it('dọn thành công: xoá đúng bản đã chọn, kết quả có dung lượng, lần xem sau không còn bản nào để dọn', async () => {
    await installedAt('0.9.6', { from: '0.9.5', to: '0.9.6' });
    const { service } = makeService();
    expect(await service.beginCleanup(['0.9.1', '0.9.0'])).toEqual({ ok: true });
    await waitJob(service);
    expect(service.jobView()).toMatchObject({ kind: 'cleanup', state: 'done' });

    const view = await service.cleanupView();
    expect(view?.lastResult).toMatchObject({ freedBytes: 80, removedVersions: ['0.9.1', '0.9.0'], failures: [] });
    const left = await readdir(join(workDir, 'images'));
    expect(left.filter((n) => /-0\.9\.(0|1)\./.test(n))).toEqual([]);
    expect(left.filter((n) => /-0\.9\.(5|6)\./.test(n))).toHaveLength(8);
    expect(await service.cleanupView()).toMatchObject({ cleanVersions: [] });
  });

  it('bản chỉ còn bị container cũ giữ ảnh: hiện ở "held", không nằm trong danh sách dọn và không dọn được', async () => {
    await installedAt('0.9.6');
    await rm(join(workDir, 'images', 'nexamed-api-0.9.0.tar.gz'));
    for (const r of ['web', 'backup', 'setup']) await rm(join(workDir, 'images', `nexamed-${r}-0.9.0.tar.gz`));
    const { service, shell } = makeService([['old-api-1', 'nexamed-api:0.9.0'], ['old-web-1', 'nexamed-web:0.9.0'], ['old-bk-1', 'nexamed-backup:0.9.0'], ['old-st-1', 'nexamed-setup:0.9.0']]);
    const view = await service.cleanupView();
    expect(view?.held).toEqual([{ version: '0.9.0', containers: expect.arrayContaining(['old-api-1', 'old-web-1']) }]);
    expect(view?.cleanVersions).not.toContain('0.9.0');
    expect(await service.beginCleanup(['0.9.0'])).toMatchObject({ ok: false });
    expect(shell.calls.some((c) => c.args[1] === 'rm')).toBe(false);
  });

  it('đang có việc chạy thì không bắt đầu việc dọn thứ hai', async () => {
    await installedAt('0.9.6');
    const { service } = makeService();
    expect(await service.beginCleanup(['0.9.0'])).toEqual({ ok: true });
    expect(await service.beginCleanup(['0.9.1'])).toEqual({ ok: false, error: 'Đang chạy, vui lòng chờ.' });
    await waitJob(service);
  });
});
