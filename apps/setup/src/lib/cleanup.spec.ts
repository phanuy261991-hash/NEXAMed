import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeShell, type Handler } from '../testing/fake-shell';
import { type CleanupKeep, buildCleanupPlan, buildCleanupSteps, newCleanupState } from './cleanup';
import { DockerClient } from './docker';
import { Job } from './job';

const REPOS = ['api', 'web', 'backup', 'setup'] as const;
const KEEP: CleanupKeep = { installed: '0.9.6', previous: '0.9.5', packageVersion: '0.9.6' };

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'nexamed-clean-'));
  await mkdir(join(workDir, 'images'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Mỗi bản có đủ 4 tệp nạp ảnh, mỗi tệp 100 byte. */
async function writeVersionFiles(...versions: string[]) {
  for (const v of versions) for (const r of REPOS) await writeFile(join(workDir, 'images', `nexamed-${r}-${v}.tar.gz`), 'x'.repeat(100));
}

function dockerWith(imageVersions: string[] | null, extra: Handler[] = []) {
  const shell = new FakeShell([
    ...extra,
    (c) => {
      if (!c.line.includes('image ls')) return undefined;
      if (imageVersions === null) return { code: 1, stderr: 'Cannot connect to the Docker daemon' };
      const lines = imageVersions.flatMap((v) => REPOS.map((r) => `nexamed-${r} ${v}`));
      return { stdout: [...lines, 'postgres 18', 'nexamed-web <none>', 'caddy 2.8-alpine'].join('\n') };
    },
  ]);
  const docker = new DockerClient(shell, { workDir, hostInstallDir: '/c/NEXAMed', probeImage: 'img' }, async () => undefined);
  return { shell, docker };
}

const removed = (shell: FakeShell) => shell.calls.filter((c) => c.args[0] === 'image' && c.args[1] === 'rm').map((c) => c.args[2]);
const remaining = async () => (await readdir(join(workDir, 'images'))).sort();

describe('kế hoạch dọn gói cũ', () => {
  it('giữ bản đang chạy, bản trước và bản mới trong gói; liệt kê bản cũ (kể cả bản chỉ còn ảnh Docker) mới nhất trước', async () => {
    await writeVersionFiles('0.9.0', '0.9.1', '0.9.5', '0.9.6');
    const { docker } = dockerWith(['0.9.0', '0.9.3', '0.9.5', '0.9.6']);
    const plan = await buildCleanupPlan({ docker, workDir }, KEEP);
    expect(plan.dockerAvailable).toBe(true);
    expect(plan.rows.map((r) => [r.version, r.action])).toEqual([
      ['0.9.6', 'running'],
      ['0.9.5', 'previous'],
      ['0.9.3', 'clean'],
      ['0.9.1', 'clean'],
      ['0.9.0', 'clean'],
    ]);
    expect(plan.cleanVersions).toEqual(['0.9.3', '0.9.1', '0.9.0']);
    expect(plan.cleanBytes).toBe(800); // 0.9.1 và 0.9.0: 4 tệp × 100 byte; 0.9.3 chỉ có ảnh Docker
    const only = plan.rows.find((r) => r.version === '0.9.3')!;
    expect(only).toMatchObject({ fileCount: 0, dockerImages: 4 });
    expect(plan.rows.find((r) => r.version === '0.9.1')).toMatchObject({ fileCount: 4, fileBytes: 400, dockerImages: 0 });
  });

  it('bản mới trong gói chưa cài luôn được giữ, dù số của nó lớn hơn hay nhỏ hơn bản đang chạy', async () => {
    await writeVersionFiles('0.9.2', '0.9.6', '0.9.7');
    const { docker } = dockerWith([]);
    const ahead = await buildCleanupPlan({ docker, workDir }, { installed: '0.9.6', previous: null, packageVersion: '0.9.7' });
    expect(ahead.rows.find((r) => r.version === '0.9.7')?.action).toBe('package');
    expect(ahead.cleanVersions).toEqual(['0.9.2']);
    const behind = await buildCleanupPlan({ docker, workDir }, { installed: '0.9.6', previous: null, packageVersion: '0.9.2' });
    expect(behind.rows.find((r) => r.version === '0.9.2')?.action).toBe('package');
    expect(behind.cleanVersions).toEqual(['0.9.7']);
  });

  it('chỉ tính ảnh ứng dụng NEXAMed: bỏ qua gói bên thứ ba, ảnh không phải của ta, ảnh không có nhãn, tệp lạ', async () => {
    await writeVersionFiles('0.9.6');
    await writeFile(join(workDir, 'images', 'third-party-postgres.tar.gz'), 'x');
    await writeFile(join(workDir, 'images', 'ghi-chu.txt'), 'x');
    const { docker } = dockerWith(['0.9.6']);
    const plan = await buildCleanupPlan({ docker, workDir }, KEEP);
    expect(plan.cleanVersions).toEqual([]);
    expect(plan.rows.map((r) => r.version)).toEqual(['0.9.6']);
  });

  it('Docker không trả lời: vẫn lập kế hoạch từ các tệp và báo dockerAvailable=false', async () => {
    await writeVersionFiles('0.9.1', '0.9.6');
    const { docker } = dockerWith(null);
    const plan = await buildCleanupPlan({ docker, workDir }, KEEP);
    expect(plan.dockerAvailable).toBe(false);
    expect(plan.cleanVersions).toEqual(['0.9.1']);
  });

  it('đếm bản sao lưu nâng cấp (chỉ tệp .dump) để hiện, không đưa vào danh sách dọn', async () => {
    await mkdir(join(workDir, 'upgrade-backups'));
    await writeFile(join(workDir, 'upgrade-backups', 'truoc-0.9.5.dump'), 'x'.repeat(300));
    await writeFile(join(workDir, 'upgrade-backups', 'truoc-0.9.6.dump'), 'x'.repeat(200));
    await writeFile(join(workDir, 'upgrade-backups', 'ghi-chu.txt'), 'x'.repeat(50));
    const { docker } = dockerWith([]);
    const plan = await buildCleanupPlan({ docker, workDir }, KEEP);
    expect(plan.backups).toEqual({ count: 2, bytes: 500 });
    expect(await readdir(join(workDir, 'upgrade-backups'))).toHaveLength(3);
  });
});

describe('chạy dọn gói cũ', () => {
  async function run(versions: string[], shell: FakeShell, docker: DockerClient) {
    const state = newCleanupState();
    const job = new Job(buildCleanupSteps(versions, { docker, workDir }, KEEP, state));
    await job.run();
    return { state, job };
  }

  it('xoá tệp nạp ảnh và gỡ ảnh Docker đúng các bản được chọn; bản được giữ, tệp bên thứ ba và mọi thứ khác còn nguyên', async () => {
    await writeVersionFiles('0.9.0', '0.9.1', '0.9.5', '0.9.6');
    await writeFile(join(workDir, 'images', 'third-party-caddy.tar.gz'), 'x');
    const { shell, docker } = dockerWith(['0.9.0', '0.9.1', '0.9.5', '0.9.6']);
    const { state, job } = await run(['0.9.1', '0.9.0'], shell, docker);

    expect(job.view().state).toBe('done');
    expect(state).toMatchObject({ freedBytes: 800, removedVersions: ['0.9.1', '0.9.0'], failures: [] });
    expect((await remaining()).filter((n) => n.startsWith('nexamed-')).every((n) => /-0\.9\.(5|6)\.tar\.gz$/.test(n))).toBe(true);
    expect(await remaining()).toContain('third-party-caddy.tar.gz');
    expect(removed(shell).sort()).toEqual(REPOS.flatMap((r) => [`nexamed-${r}:0.9.0`, `nexamed-${r}:0.9.1`]).sort());
    expect(removed(shell).some((ref) => /:0\.9\.(5|6)$/.test(String(ref)))).toBe(false);
  });

  it('không bao giờ dọn bản đang giữ dù danh sách gửi tới có nó: không xoá tệp, không gỡ ảnh, không ghi lỗi', async () => {
    await writeVersionFiles('0.9.5', '0.9.6');
    const { shell, docker } = dockerWith(['0.9.5', '0.9.6']);
    const { state, job } = await run(['0.9.6', '0.9.5'], shell, docker);
    expect(job.view().steps.map((s) => s.note)).toEqual(['Đang được giữ, bỏ qua', 'Đang được giữ, bỏ qua']);
    expect(state).toMatchObject({ freedBytes: 0, removedVersions: [], failures: [] });
    expect(await remaining()).toHaveLength(8);
    expect(removed(shell)).toEqual([]);
  });

  it('ảnh Docker đang được container dùng: tệp vẫn xoá, bản đó ghi lỗi "in-use" và các bản khác vẫn dọn tiếp', async () => {
    await writeVersionFiles('0.9.0', '0.9.1');
    const busy: Handler = (c) => (c.args[1] === 'rm' && c.args[2] === 'nexamed-web:0.9.1' ? { code: 1, stderr: 'Error response from daemon: conflict: unable to delete (cannot be forced) - image is being used by running container abc' } : undefined);
    const { docker, shell } = dockerWith(['0.9.0', '0.9.1'], [busy]);
    const { state } = await run(['0.9.1', '0.9.0'], shell, docker);
    expect(state.failures).toEqual([{ version: '0.9.1', reason: 'in-use' }]);
    expect(state.removedVersions).toEqual(['0.9.0']);
    expect(state.freedBytes).toBe(800);
    expect(await remaining()).toEqual([]);
  });

  it('Docker không trả lời lúc dọn: tệp vẫn xoá, mọi bản ghi lỗi "docker-unavailable" để dọn lại sau', async () => {
    await writeVersionFiles('0.9.0');
    const { docker, shell } = dockerWith(null);
    const { state, job } = await run(['0.9.0'], shell, docker);
    expect(job.view().state).toBe('done');
    expect(state.failures).toEqual([{ version: '0.9.0', reason: 'docker-unavailable' }]);
    expect(state.freedBytes).toBe(400);
    expect(await remaining()).toEqual([]);
  });

  it('không xoá được một tệp: ghi lỗi "file", các tệp khác của bản đó vẫn xoá', async () => {
    await writeVersionFiles('0.9.0');
    await rm(join(workDir, 'images', 'nexamed-api-0.9.0.tar.gz'));
    await mkdir(join(workDir, 'images', 'nexamed-api-0.9.0.tar.gz')); // thư mục trùng tên: unlink sẽ lỗi
    const { docker, shell } = dockerWith([]);
    const { state } = await run(['0.9.0'], shell, docker);
    expect(state.failures).toEqual([{ version: '0.9.0', reason: 'file' }]);
    expect(await remaining()).toEqual(['nexamed-api-0.9.0.tar.gz']);
  });
});

describe('DockerClient — ảnh ứng dụng', () => {
  it('removeImage coi "No such image" là đã xong, "in use" là in-use, lỗi khác là other', async () => {
    const mk = (stderr: string) => new DockerClient(new FakeShell([(c) => (c.args[1] === 'rm' ? { code: 1, stderr } : undefined)]), { workDir, hostInstallDir: '/x', probeImage: 'i' });
    expect(await mk('Error: No such image: nexamed-api:1').removeImage('nexamed-api:1')).toEqual({ ok: true });
    expect(await mk('conflict: image is being used by stopped container').removeImage('nexamed-api:1')).toEqual({ ok: false, reason: 'in-use' });
    expect(await mk('boom').removeImage('nexamed-api:1')).toEqual({ ok: false, reason: 'other' });
  });
  it('removeImage không bao giờ dùng cờ ép buộc -f', async () => {
    const { docker, shell } = dockerWith([]);
    await docker.removeImage('nexamed-api:0.9.0');
    const call = shell.calls.find((c) => c.args[1] === 'rm')!;
    expect(call.args).toEqual(['image', 'rm', 'nexamed-api:0.9.0']);
  });
});
