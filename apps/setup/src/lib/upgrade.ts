/**
 * NÂNG CẤP lên bản mới và QUAY LUI (docs/DECISIONS.md #238): sao lưu `pg_dump -Fc` trước, nạp ảnh, đổi `NEXAMED_VERSION`, `compose up -d` (service `migrate` áp thay đổi
 * cấu trúc dữ liệu), kiểm tra sức khoẻ; lỗi thì tự khôi phục bản sao lưu và chạy lại bản cũ. Cấu hình (`.env`, `config.json`, bí mật) KHÔNG đổi.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerClient } from './docker';
import { getEnvValue, setEnvValues } from './env-file';
import type { StepDef } from './job';
import { APP_IMAGES, discoverPackage, fileExists } from './package-files';

export interface UpgradeDeps {
  docker: DockerClient;
  workDir: string;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface UpgradeRecord {
  from: string;
  to: string;
  /** Tên file bản sao lưu trong `upgrade-backups/` (không kèm đường dẫn). */
  backupFile: string;
  at: string;
  rolledBack?: boolean;
}

export interface SetupState {
  lastUpgrade?: UpgradeRecord;
}

const STATE_FILE = '.setup-state.json';
export const BACKUP_DIR_NAME = 'upgrade-backups';

export async function readSetupState(workDir: string): Promise<SetupState> {
  try {
    return JSON.parse(await readFile(join(workDir, STATE_FILE), 'utf8')) as SetupState;
  } catch {
    return {};
  }
}

async function writeSetupState(workDir: string, state: SetupState): Promise<void> {
  await writeFile(join(workDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

async function readEnv(workDir: string): Promise<string> {
  return readFile(join(workDir, '.env'), 'utf8');
}

async function setVersion(workDir: string, version: string): Promise<void> {
  const text = await readEnv(workDir);
  await writeFile(join(workDir, '.env'), setEnvValues(text, { NEXAMED_VERSION: version }), { mode: 0o600 });
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

async function dbIdentity(workDir: string): Promise<{ user: string; db: string }> {
  const text = await readEnv(workDir);
  return { user: getEnvValue(text, 'POSTGRES_USER') ?? 'nexamed', db: getEnvValue(text, 'POSTGRES_DB') ?? 'nexamed' };
}

/** Kiểm tra web mở được và máy chủ trả đúng phiên bản mong muốn. */
async function verifyRunning(docker: DockerClient, expectVersion: string): Promise<void> {
  if (!(await docker.waitHealthy('api', 180_000))) throw new Error('Máy chủ ứng dụng chưa báo khoẻ sau 3 phút.');
  const page = await docker.compose(['exec', '-T', 'web', 'wget', '-q', '-O', '-', 'http://127.0.0.1/']);
  if (page.code !== 0) throw new Error('Không mở được trang giao diện.');
  const version = await docker.compose(['exec', '-T', 'web', 'wget', '-q', '-O', '-', 'http://127.0.0.1/api/v1/system/version']);
  if (version.code !== 0) throw new Error('Giao diện không gọi được máy chủ ứng dụng.');
  let reported = '';
  try {
    reported = String((JSON.parse(version.stdout) as { data?: { version?: string } }).data?.version ?? '');
  } catch {
    reported = '';
  }
  if (reported !== expectVersion) throw new Error(`Máy chủ đang báo phiên bản ${reported || 'không rõ'}, không phải ${expectVersion}.`);
}

/** Khôi phục bản sao lưu và chạy lại phiên bản cũ. Dùng cho cả tự quay lui lúc nâng cấp lỗi và nút "Quay lui về bản cũ". */
export async function rollback(deps: UpgradeDeps, record: UpgradeRecord, log: (line: string) => void): Promise<void> {
  const { docker, workDir } = deps;
  const dump = join(workDir, BACKUP_DIR_NAME, record.backupFile);
  if (!(await fileExists(dump))) throw new Error(`Không thấy bản sao lưu ${record.backupFile} để khôi phục.`);
  const { user, db } = await dbIdentity(workDir);
  log(`Dừng ứng dụng, khôi phục bản sao lưu ${record.backupFile} ...`);
  await docker.compose(['stop', 'api', 'web', 'backup', 'caddy']);
  await setVersion(workDir, record.from);
  const up = await docker.compose(['up', '-d', 'postgres']);
  if (up.code !== 0) throw new Error('Không khởi động được cơ sở dữ liệu để khôi phục.');
  if (!(await docker.waitHealthy('postgres', 120_000))) throw new Error('Cơ sở dữ liệu không sẵn sàng để khôi phục.');
  // Tạo lại cơ sở dữ liệu trống rồi nạp bản sao lưu: tránh sót bảng do bản mới thêm (sẽ làm lần nâng cấp sau báo "đã tồn tại").
  const steps: string[][] = [
    ['exec', '-T', 'postgres', 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`],
    ['exec', '-T', 'postgres', 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${db}"`],
    ['cp', dump, 'postgres:/tmp/restore.dump'],
    ['exec', '-T', 'postgres', 'pg_restore', '-U', user, '-d', db, '--exit-on-error', '/tmp/restore.dump'],
    ['exec', '-T', 'postgres', 'rm', '-f', '/tmp/restore.dump'],
  ];
  for (const args of steps) {
    const result = await docker.compose(args, { timeoutMs: 30 * 60_000 });
    if (result.code !== 0) throw new Error(`Khôi phục dữ liệu thất bại: ${(result.stderr || result.stdout).trim().split(/\r?\n/).pop()}`);
  }
  const all = await docker.compose(['up', '-d'], { onLine: log, timeoutMs: 20 * 60_000 });
  if (all.code !== 0) throw new Error(`Khởi động lại bản cũ thất bại: ${all.stderr.trim().split(/\r?\n/).pop()}`);
  await verifyRunning(docker, record.from);
}

export function buildUpgradeSteps(from: string, to: string, deps: UpgradeDeps, state: { record?: UpgradeRecord }): StepDef[] {
  const { docker, workDir } = deps;
  const backupDir = join(workDir, BACKUP_DIR_NAME);
  const backupFile = `truoc-${to}-${stamp(deps.now())}.dump`;
  const record: UpgradeRecord = { from, to, backupFile, at: deps.now().toISOString() };

  return [
    {
      id: 'backup',
      title: 'Sao lưu dữ liệu hiện tại',
      detail: 'Bản sao đầy đủ trước khi đổi gì',
      run: async (ctx) => {
        await mkdir(backupDir, { recursive: true });
        const { user, db } = await dbIdentity(workDir);
        const up = await docker.compose(['up', '-d', 'postgres']);
        if (up.code !== 0 || !(await docker.waitHealthy('postgres', 120_000))) throw new Error('Cơ sở dữ liệu không chạy nên không sao lưu được. Hệ thống CHƯA bị thay đổi.');
        const target = join(backupDir, backupFile);
        const dump = await docker.compose(['exec', '-T', 'postgres', 'pg_dump', '-U', user, '-Fc', db], { stdoutFile: target, timeoutMs: 60 * 60_000 });
        const size = (await stat(target).catch(() => ({ size: 0 }))).size;
        if (dump.code !== 0 || size === 0) throw new Error(`Sao lưu thất bại nên dừng, hệ thống CHƯA bị thay đổi: ${dump.stderr.trim().split(/\r?\n/).pop()}`);
        ctx.note(`${(size / 1024 / 1024).toFixed(1)} MB`);
      },
    },
    {
      id: 'images',
      title: `Nạp ảnh bản ${to}`,
      detail: '3 gói',
      run: async (ctx) => {
        const pkg = await discoverPackage(workDir);
        for (const name of APP_IMAGES) {
          const ref = `${name}:${to}`;
          if (await docker.imageExists(ref)) continue;
          const file = pkg.files.get(ref);
          if (!file) throw new Error(`Thiếu file ảnh ${ref} trong thư mục images.`);
          ctx.log(`Nạp ${ref} ...`);
          await docker.loadImage(file, ctx.log);
        }
      },
    },
    {
      id: 'apply',
      title: 'Áp thay đổi cấu trúc dữ liệu và khởi động lại ứng dụng',
      detail: 'Giữ nguyên cấu hình và dữ liệu',
      run: async (ctx) => {
        await setVersion(workDir, to);
        const up = await docker.compose(['up', '-d'], { onLine: ctx.log, timeoutMs: 20 * 60_000 });
        if (up.code !== 0) {
          await failWithRollback(deps, record, ctx.log, `Khởi động bản mới thất bại: ${up.stderr.trim().split(/\r?\n/).pop()}`);
        }
      },
    },
    {
      id: 'health',
      title: 'Kiểm tra sức khoẻ',
      detail: 'Nếu lỗi, tự quay lui về bản cũ từ bản sao lưu',
      run: async (ctx) => {
        try {
          await verifyRunning(docker, to);
        } catch (err) {
          await failWithRollback(deps, record, ctx.log, err instanceof Error ? err.message : String(err));
        }
        await writeSetupState(workDir, { ...(await readSetupState(workDir)), lastUpgrade: record });
        state.record = record;
      },
    },
  ];
}

async function failWithRollback(deps: UpgradeDeps, record: UpgradeRecord, log: (line: string) => void, reason: string): Promise<never> {
  log(`Nâng cấp lỗi: ${reason}. Đang quay lui về bản ${record.from} ...`);
  try {
    await rollback(deps, record, log);
  } catch (err) {
    throw new Error(`${reason} Quay lui tự động cũng thất bại (${err instanceof Error ? err.message : String(err)}). Bản sao lưu vẫn còn ở ${BACKUP_DIR_NAME}/${record.backupFile}; liên hệ nhà cung cấp.`);
  }
  throw new Error(`${reason} Hệ thống đã quay lui về bản ${record.from} và hoạt động như trước khi nâng cấp.`);
}

/** Bước đơn cho nút "Quay lui về bản cũ" sau khi nâng cấp thành công. */
export function buildManualRollbackSteps(record: UpgradeRecord, deps: UpgradeDeps): StepDef[] {
  return [
    {
      id: 'rollback',
      title: `Quay lui về bản ${record.from}`,
      detail: 'Khôi phục dữ liệu từ bản sao lưu trước khi nâng cấp',
      run: async (ctx) => {
        await rollback(deps, record, ctx.log);
        await writeSetupState(deps.workDir, { ...(await readSetupState(deps.workDir)), lastUpgrade: { ...record, rolledBack: true } });
      },
    },
  ];
}
