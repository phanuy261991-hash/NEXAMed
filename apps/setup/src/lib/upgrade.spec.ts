import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeShell, type Handler, psJson } from '../testing/fake-shell';
import { DockerClient } from './docker';
import { getEnvValue } from './env-file';
import { Job } from './job';
import { BACKUP_DIR_NAME, buildManualRollbackSteps, buildUpgradeSteps, readSetupState, type UpgradeRecord } from './upgrade';
import { compareVersions, discoverPackage, readInstalledVersion } from './package-files';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-upg-'));
  await mkdir(join(workDir, 'images'));
  for (const v of ['0.9.0', '0.10.0']) for (const n of ['api', 'web', 'backup']) await writeFile(join(workDir, 'images', `nexamed-${n}-${v}.tar.gz`), 'x');
  await writeFile(join(workDir, '.env'), 'NEXAMED_VERSION=0.9.0\nPOSTGRES_USER=nexamed\nPOSTGRES_DB=nexamed\nJWT_SECRET=keep-me\n');
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const healthy = psJson([{ Service: 'postgres', Health: 'healthy' }, { Service: 'api', Health: 'healthy' }, { Service: 'web' }]);

function make(handlers: Handler[] = []) {
  const shell = new FakeShell([
    ...handlers,
    (c) => (c.line.includes('image inspect') ? { code: 1 } : undefined),
    (c) => (c.line.includes(' ps --all --format json') ? { stdout: healthy } : undefined),
    (c) => (c.line.includes('/api/v1/system/version') ? { stdout: '{"data":{"version":"0.10.0"}}' } : undefined),
  ]);
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'img' }, async () => undefined);
  const deps = { docker, workDir, now: () => new Date('2026-10-15T10:00:00Z') };
  const state: { record?: UpgradeRecord } = {};
  return { shell, deps, state, job: new Job(buildUpgradeSteps('0.9.0', '0.10.0', deps, state)) };
}

describe('nâng cấp', () => {
  it('sao lưu → nạp ảnh → đổi phiên bản → khởi động → kiểm tra, giữ nguyên cấu hình, ghi trạng thái để quay lui', async () => {
    const { shell, job, state } = make();
    await job.run();
    expect(job.view().error).toBeNull();
    expect(job.view().steps.map((s) => s.id)).toEqual(['backup', 'images', 'apply', 'health']);

    const compose = shell.composeCalls();
    const dumpIdx = compose.findIndex((l) => l.includes('pg_dump'));
    const upIdx = compose.lastIndexOf('up -d');
    expect(dumpIdx).toBeGreaterThanOrEqual(0);
    expect(dumpIdx).toBeLessThan(upIdx); // sao lưu TRƯỚC khi đổi gì
    expect(shell.calls.filter((c) => c.args[0] === 'load')).toHaveLength(3);

    const env = await readFile(join(workDir, '.env'), 'utf8');
    expect(getEnvValue(env, 'NEXAMED_VERSION')).toBe('0.10.0');
    expect(getEnvValue(env, 'JWT_SECRET')).toBe('keep-me');

    expect(state.record?.backupFile).toMatch(/^truoc-0\.10\.0-20261015-100000\.dump$/);
    expect((await readSetupState(workDir)).lastUpgrade).toMatchObject({ from: '0.9.0', to: '0.10.0' });
    expect((await readFile(join(workDir, BACKUP_DIR_NAME, state.record!.backupFile), 'utf8')).length).toBeGreaterThan(0);
  });

  it('sao lưu lỗi thì DỪNG, hệ thống chưa bị đổi (.env giữ phiên bản cũ, không nạp ảnh)', async () => {
    const { shell, job } = make([(c) => (c.line.includes('pg_dump') ? { code: 1, stderr: 'disk full', stdout: '' } : undefined)]);
    // pg_dump thất bại và để lại file rỗng
    await job.run();
    expect(job.view().state).toBe('failed');
    expect(job.view().error).toContain('CHƯA bị thay đổi');
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'NEXAMED_VERSION')).toBe('0.9.0');
    expect(shell.calls.some((c) => c.args[0] === 'load')).toBe(false);
  });

  it('kiểm tra sức khoẻ lỗi → tự quay lui: tạo lại CSDL, khôi phục dump, đặt lại phiên bản cũ', async () => {
    // Lần kiểm tra đầu (bản mới) lỗi; sau quay lui, kiểm tra bản cũ gọi cùng endpoint và thành công.
    let calls = 0;
    const { shell, job } = make([(c) => (c.line.includes('/api/v1/system/version') ? (++calls === 1 ? { code: 1 } : { stdout: '{"data":{"version":"0.9.0"}}' }) : undefined)]);
    await job.run();
    expect(job.view().state).toBe('failed');
    expect(job.view().error).toContain('đã quay lui về bản 0.9.0');
    const compose = shell.composeCalls();
    expect(compose.some((l) => l.includes('DROP DATABASE IF EXISTS "nexamed" WITH (FORCE)'))).toBe(true);
    expect(compose.some((l) => l.includes('pg_restore'))).toBe(true);
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'NEXAMED_VERSION')).toBe('0.9.0');
    expect((await readSetupState(workDir)).lastUpgrade).toBeUndefined(); // lần nâng cấp lỗi không được ghi là thành công
  });

  it('quay lui tự động cũng lỗi thì báo rõ nơi còn bản sao lưu', async () => {
    const { job } = make([(c) => (c.line.includes('/api/v1/system/version') ? { code: 1 } : undefined), (c) => (c.line.includes('pg_restore') ? { code: 1, stderr: 'boom' } : undefined)]);
    await job.run();
    expect(job.view().error).toContain('Quay lui tự động cũng thất bại');
    expect(job.view().error).toContain(BACKUP_DIR_NAME);
  });

  it('nút "Quay lui về bản cũ" khôi phục từ bản sao lưu của lần nâng cấp gần nhất', async () => {
    const first = make();
    await first.job.run();
    const record = (await readSetupState(workDir)).lastUpgrade!;
    const second = make([(c) => (c.line.includes('/api/v1/system/version') ? { stdout: '{"data":{"version":"0.9.0"}}' } : undefined)]);
    await new Job(buildManualRollbackSteps(record, second.deps)).run();
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'NEXAMED_VERSION')).toBe('0.9.0');
    expect((await readSetupState(workDir)).lastUpgrade?.rolledBack).toBe(true);
  });
});

describe('quay lui về bản cũ chưa có /system/version (hệ thống cài trước 0.9)', () => {
  it('vẫn thành công nếu api khoẻ và web mở được', async () => {
    const first = make();
    await first.job.run();
    const record = (await readSetupState(workDir)).lastUpgrade!;
    const second = make([(c) => (c.line.includes('/api/v1/system/version') ? { code: 1, stderr: 'wget: server returned error: HTTP/1.1 404 Not Found' } : undefined)]);
    const job = new Job(buildManualRollbackSteps(record, second.deps));
    await job.run();
    expect(job.view().error).toBeNull();
    expect(job.view().state).toBe('done');
    expect(getEnvValue(await readFile(join(workDir, '.env'), 'utf8'), 'NEXAMED_VERSION')).toBe('0.9.0');
  });
  it('nhưng nâng cấp tiến (bản mới) vẫn BẮT BUỘC đường dẫn phiên bản trả đúng', async () => {
    const { job } = make([(c) => (c.line.includes('/api/v1/system/version') ? { code: 1 } : undefined)]);
    await job.run();
    expect(job.view().state).toBe('failed');
  });
});

describe('gói cài đặt', () => {
  it('so sánh phiên bản theo từng đoạn số (0.10.0 > 0.9.0, 2026.10.15.2 > 2026.10.15)', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2026.10.15.2', '2026.10.15')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('chỉ tính phiên bản có đủ cả 3 ảnh, mới nhất trước', async () => {
    await writeFile(join(workDir, 'images', 'nexamed-api-0.11.0.tar.gz'), 'x');
    const pkg = await discoverPackage(workDir);
    expect(pkg.versions).toEqual(['0.10.0', '0.9.0']);
  });
  it('file VERSION của gói thắng thứ tự số: ảnh kiểu ngày của bản cài cũ còn sót không bị coi là bản mới nhất', async () => {
    for (const n of ['api', 'web', 'backup']) await writeFile(join(workDir, 'images', `nexamed-${n}-2026.10.15.tar.gz`), 'x');
    expect((await discoverPackage(workDir)).versions[0]).toBe('2026.10.15'); // không có VERSION: chọn theo số, nhầm bản cũ
    await writeFile(join(workDir, 'VERSION'), '0.9.0\n');
    const pkg = await discoverPackage(workDir);
    expect(pkg.versions[0]).toBe('0.9.0');
    expect(pkg.versions).toContain('2026.10.15');
    await writeFile(join(workDir, 'VERSION'), '7.7.7'); // khai báo bản không đủ ảnh thì bỏ qua
    expect((await discoverPackage(workDir)).versions[0]).toBe('2026.10.15');
  });
  it('đọc phiên bản đang cài; giá trị mẫu hoặc chưa có .env coi là chưa cài', async () => {
    expect(await readInstalledVersion(workDir)).toBe('0.9.0');
    await writeFile(join(workDir, '.env'), 'NEXAMED_VERSION=doi-gia-tri-nay-khop\n');
    expect(await readInstalledVersion(workDir)).toBeNull();
    await rm(join(workDir, '.env'));
    expect(await readInstalledVersion(workDir)).toBeNull();
  });
});
