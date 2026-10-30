import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerClient } from './lib/docker';
import { SetupService } from './service';
import { FakeShell, psJson } from './testing/fake-shell';

/** `detect()` trả ghi chú phát hành đóng trong gói (mockup https://claude.ai/artifact/R6oTbDuS7fczynmib7V5BT, 30/10/2026): chỉ khi NÂNG CẤP, không bao giờ làm hỏng bước dò. */

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-setup-notes-'));
  await mkdir(join(workDir, 'images'));
  for (const n of ['api', 'web', 'backup']) await writeFile(join(workDir, 'images', `nexamed-${n}-0.9.0.tar.gz`), 'x');
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeService() {
  const shell = new FakeShell([(c) => (c.line.includes(' ps --all --format json') ? { stdout: psJson([{ Service: 'api', Health: 'healthy' }]) } : undefined)]);
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'nexamed-setup:0.9.0' }, async () => undefined);
  return new SetupService({ workDir, hostInstallDir: '/c/NEXAMed', hostIps: ['192.168.1.50'], setupVersion: '0.9.0', hostInstallDirDisplay: 'C:\\NEXAMed' }, docker, { sleep: async () => undefined });
}

/** Hệ thống đã cài đầy đủ ở phiên bản `version` (tenant thật, không phải mã giữ chỗ → không bị coi là cài dở). */
async function installedAt(version: string) {
  await writeFile(join(workDir, '.env'), `NEXAMED_VERSION=${version}\nWEB_HTTP_PORT=8080\n`);
  await writeFile(join(workDir, 'config.json'), JSON.stringify({ apiBaseUrl: '', tenantId: '11111111-2222-3333-4444-555555555555' }));
}

async function writeNotes(version: string, extra: Partial<{ features: string[]; improvements: string[]; fixes: string[] }> = {}) {
  await mkdir(join(workDir, 'release-notes'), { recursive: true });
  await writeFile(join(workDir, 'release-notes', `${version}.json`), JSON.stringify({ version, releasedAt: '2026-10-15', features: [`Tính năng của ${version}`], improvements: [], fixes: [], ...extra }));
}

describe('detect() — ghi chú phát hành khi nâng cấp', () => {
  it('nâng cấp 0.8.0 → 0.9.0: trả ghi chú của các bản SAU bản đang chạy đến bản sắp cài, mới nhất trước (không gồm chính bản đang chạy)', async () => {
    await installedAt('0.8.0');
    await writeNotes('0.8.0');
    await writeNotes('0.8.5', { fixes: ['Sửa lỗi in phiếu'] });
    await writeNotes('0.9.0');
    const detect = await makeService().detect();
    expect(detect.mode).toBe('upgrade');
    expect(detect.releaseNotes?.from).toBe('0.8.0');
    expect(detect.releaseNotes?.to).toBe('0.9.0');
    expect(detect.releaseNotes?.items.map((i) => i.version)).toEqual(['0.9.0', '0.8.5']);
    expect(detect.releaseNotes?.items[1]?.fixes).toEqual(['Sửa lỗi in phiếu']);
  });

  it('gói KHÔNG kèm thư mục ghi chú (gói cũ) → releaseNotes null, vẫn dò bình thường, không báo lỗi', async () => {
    await installedAt('0.8.0');
    const detect = await makeService().detect();
    expect(detect.mode).toBe('upgrade');
    expect(detect.releaseNotes).toBeNull();
    expect(detect.packageVersion).toBe('0.9.0');
  });

  it('cài MỚI (chưa có hệ thống) → không hiện ghi chú dù gói có kèm', async () => {
    await writeNotes('0.9.0');
    const detect = await makeService().detect();
    expect(detect.mode).toBe('install');
    expect(detect.releaseNotes).toBeNull();
  });

  it('đã là bản mới nhất → không có gì để hiện', async () => {
    await installedAt('0.9.0');
    await writeNotes('0.9.0');
    const detect = await makeService().detect();
    expect(detect.upToDate).toBe(true);
    expect(detect.releaseNotes).toBeNull();
  });

  it('một file ghi chú hỏng (JSON sai / tên file lệch phiên bản) bị bỏ qua, các bản còn lại vẫn hiện', async () => {
    await installedAt('0.8.0');
    await writeNotes('0.9.0');
    await writeFile(join(workDir, 'release-notes', '0.8.5.json'), '{ không phải JSON');
    await writeFile(join(workDir, 'release-notes', '0.8.6.json'), JSON.stringify({ version: '0.8.9', releasedAt: '2026-10-15', features: ['x'], improvements: [], fixes: [] }));
    const detect = await makeService().detect();
    expect(detect.releaseNotes?.items.map((i) => i.version)).toEqual(['0.9.0']);
  });
});
