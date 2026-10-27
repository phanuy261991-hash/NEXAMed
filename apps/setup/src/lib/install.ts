/**
 * Chuỗi bước CÀI MỚI (docs/DECISIONS.md #238). Mỗi bước là một hàm có thể chạy lại (idempotent) để nút "Thử lại" tiếp tục từ bước lỗi:
 * `.env` đã có thì giữ nguyên bí mật (mất khoá mã hoá là mất dữ liệu đã mã hoá), phòng khám đã tạo thì không tạo lại.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerClient } from './docker';
import { setEnvValues } from './env-file';
import type { StepDef } from './job';
import { APP_IMAGES, PLACEHOLDER_TENANT, THIRD_PARTY_IMAGES, discoverPackage, fileExists } from './package-files';
import { type InstallAnswers, type InstallPlan, buildPlan } from './profiles';

export interface InstallDeps {
  docker: DockerClient;
  workDir: string;
  version: string;
  random: { hex: (bytes: number) => string; tempPassword: () => string };
  /** Chứng chỉ wildcard đã kiểm tra (chỉ kiểu SaaS). */
  cert?: { crt: string; key: string };
  /** Bí mật OTP do trình cài đặt sinh sẵn (chỉ kiểu SaaS). */
  operatorTotpSecret?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface InstallResult {
  profile: InstallAnswers['profile'];
  publicUrl: string;
  username: string;
  /** Mật khẩu tạm (LAN/VPS) — hiện đúng một lần ở trang kết quả. */
  tempPassword?: string;
  tenantId?: string;
  totpSecret?: string;
  version: string;
  plan: InstallPlan;
}

export const SEED_RESULT_PREFIX = 'NEXAMED_RESULT ';

/** Lỗi của Docker khi cổng máy đã bị chiếm (Windows: "Only one usage of each socket address"; Linux: "address already in use"). */
const PORT_BUSY = /ports are not available|port is already allocated|address already in use|Only one usage of each socket address/i;

/** Lấy JSON của dòng `NEXAMED_RESULT {...}` trong đầu ra của script tạo tài khoản. */
export function parseSeedResult<T>(output: string): T {
  const line = output.split(/\r?\n/).find((l) => l.startsWith(SEED_RESULT_PREFIX));
  if (!line) throw new Error('Không đọc được kết quả tạo tài khoản từ máy chủ.');
  return JSON.parse(line.slice(SEED_RESULT_PREFIX.length)) as T;
}

/** Ghi `.env`: lần đầu sinh bí mật ngẫu nhiên từ `.env.example`; các lần sau chỉ cập nhật đúng các khoá do trình cài đặt quản lý. */
export async function writeEnvFile(workDir: string, managed: Record<string, string>, random: InstallDeps['random']): Promise<{ created: boolean }> {
  const envPath = join(workDir, '.env');
  const exists = await fileExists(envPath);
  let text = exists ? await readFile(envPath, 'utf8') : await readFile(join(workDir, '.env.example'), 'utf8');
  const values: Record<string, string> = { ...managed };
  if (!exists) {
    values.POSTGRES_PASSWORD = random.hex(24);
    values.NEXAMED_APP_DB_PASSWORD = random.hex(24);
    values.JWT_SECRET = random.hex(32);
    values.ENCRYPTION_KEY = random.hex(32);
  }
  text = setEnvValues(text, values);
  await writeFile(envPath, text, { mode: 0o600 });
  return { created: !exists };
}

async function writeConfigJson(workDir: string, config: InstallPlan['configJson']): Promise<void> {
  // Ghi đè TẠI CHỖ (cùng inode): web bind-mount file này, ghi bằng cách đổi tên file sẽ làm container còn trỏ vào bản cũ.
  await writeFile(join(workDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export function buildInstallSteps(answers: InstallAnswers, deps: InstallDeps, state: { result?: InstallResult }): StepDef[] {
  const { docker, workDir } = deps;
  const plan = buildPlan(answers);
  const https = answers.profile !== 'lan';
  const steps: StepDef[] = [];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  steps.push({
    id: 'images',
    title: 'Nạp ảnh cài đặt',
    detail: https ? '3 gói: ứng dụng, giao diện, sao lưu (cùng cơ sở dữ liệu và HTTPS)' : '3 gói: ứng dụng, giao diện, sao lưu (cùng cơ sở dữ liệu)',
    run: async (ctx) => {
      const pkg = await discoverPackage(workDir);
      const version = pkg.versions.includes(deps.version) ? deps.version : pkg.versions[0];
      if (!version) throw new Error('Không thấy đủ 3 file ảnh (nexamed-api, nexamed-web, nexamed-backup) trong thư mục images. Giải nén đủ gói cài đặt rồi thử lại.');
      for (const name of APP_IMAGES) {
        const ref = `${name}:${version}`;
        if (await docker.imageExists(ref)) {
          ctx.log(`Ảnh ${ref} đã có sẵn.`);
          continue;
        }
        const file = pkg.files.get(ref);
        if (!file) throw new Error(`Thiếu file ảnh ${ref}.`);
        ctx.log(`Nạp ${ref} ...`);
        await docker.loadImage(file, ctx.log);
      }
      for (const tp of THIRD_PARTY_IMAGES) {
        if (tp.ref.startsWith('caddy') && !https) continue;
        if (await docker.imageExists(tp.ref)) continue;
        const file = pkg.files.get(tp.ref);
        if (file) {
          ctx.log(`Nạp ${tp.ref} ...`);
          await docker.loadImage(file, ctx.log);
        } else {
          ctx.log(`Gói không kèm ảnh ${tp.ref}, Docker sẽ tải từ Internet khi khởi động.`);
        }
      }
      deps.version = version;
    },
  });

  steps.push({
    id: 'config',
    title: 'Ghi cấu hình',
    detail: 'Tạo mật khẩu và khoá ngẫu nhiên, lưu an toàn trong cấu hình',
    run: async (ctx) => {
      const { created } = await writeEnvFile(workDir, { ...plan.env, NEXAMED_VERSION: deps.version }, deps.random);
      ctx.note(created ? 'đã tạo mới' : 'giữ nguyên khoá cũ');
      await mkdir(join(workDir, 'certs'), { recursive: true });
      const configPath = join(workDir, 'config.json');
      const config = answers.profile === 'saas' ? plan.configJson : { ...plan.configJson, tenantId: PLACEHOLDER_TENANT };
      // Cài lại (thử lại) thì giữ tenantId đã ghi nếu có.
      if (await fileExists(configPath)) {
        try {
          const old = JSON.parse(await readFile(configPath, 'utf8')) as { tenantId?: string };
          if (old.tenantId && answers.profile !== 'saas') config.tenantId = old.tenantId;
        } catch {
          // File hỏng thì ghi đè.
        }
      }
      await writeConfigJson(workDir, config);
      if (plan.caddyfile) await writeFile(join(workDir, 'Caddyfile'), plan.caddyfile);
      if (deps.cert) {
        await writeFile(join(workDir, 'certs', 'fullchain.crt'), deps.cert.crt);
        const keyPath = join(workDir, 'certs', 'privkey.key');
        await writeFile(keyPath, deps.cert.key, { mode: 0o600 });
        await chmod(keyPath, 0o644).catch(() => undefined); // Caddy trong container đọc file với người dùng khác.
      }
    },
  });

  steps.push({
    id: 'database',
    title: 'Khởi động cơ sở dữ liệu',
    detail: 'PostgreSQL 18',
    run: async (ctx) => {
      const up = await docker.compose(['up', '-d', 'postgres'], { onLine: ctx.log, timeoutMs: 10 * 60_000 });
      if (up.code !== 0) throw new Error(`Không khởi động được cơ sở dữ liệu: ${up.stderr.trim().split(/\r?\n/).pop()}`);
      if (!(await docker.waitHealthy('postgres', 120_000))) throw new Error('Cơ sở dữ liệu không báo sẵn sàng sau 2 phút. Xem nhật ký bằng "docker compose logs postgres".');
    },
  });

  steps.push({
    id: 'app',
    title: 'Tạo cấu trúc dữ liệu và khởi động ứng dụng',
    detail: 'Áp các bản cập nhật cấu trúc, gieo danh mục mặc định, bật máy chủ, giao diện, dịch vụ sao lưu',
    run: async (ctx) => {
      const up = await docker.compose(['up', '-d'], { onLine: ctx.log, timeoutMs: 20 * 60_000 });
      if (up.code !== 0) {
        const logs = await docker.compose(['logs', '--no-color', '--tail', '40', 'migrate']);
        ctx.log(logs.stdout.trim());
        const reason = up.stderr.trim().split(/\r?\n/).pop() ?? '';
        // Cổng web bị chương trình khác trên máy chiếm (Apache/XAMPP, IIS, ...): nói rõ bằng tiếng Việt và chỉ cách sửa thay vì hiện nguyên lỗi của Docker.
        if (PORT_BUSY.test(reason)) {
          throw new Error(`Cổng web ${answers.webPort ?? 80} đang bị chương trình khác trên máy dùng. Bấm "Sửa thông tin", đổi sang cổng khác (ví dụ 8081) rồi cài lại; hoặc tắt chương trình đang chiếm cổng đó.`);
        }
        throw new Error(`Khởi động hệ thống thất bại: ${reason}`);
      }
    },
  });

  if (https) {
    steps.push({
      id: 'https',
      title: answers.profile === 'saas' ? 'Bật HTTPS với chứng chỉ wildcard' : 'Xin chứng chỉ HTTPS',
      detail: answers.profile === 'saas' ? `Cho *.${answers.domain}` : `Cho ${answers.domain}`,
      run: async (ctx) => {
        if (answers.profile === 'saas') {
          await sleep(5000);
          const caddy = (await docker.services()).find((s) => s.service === 'caddy');
          if (!caddy || caddy.state !== 'running') {
            const logs = await docker.compose(['logs', '--no-color', '--tail', '20', 'caddy']);
            throw new Error(`Caddy không chạy được (kiểm tra lại chứng chỉ): ${(logs.stdout + logs.stderr).trim().split(/\r?\n/).pop()}`);
          }
          return;
        }
        const { found, tail } = await docker.waitForLog('caddy', /certificate obtained successfully/i, 180_000);
        if (!found) {
          ctx.log(tail.split(/\r?\n/).slice(-8).join('\n'));
          throw new Error(`Chưa xin được chứng chỉ HTTPS cho ${answers.domain}. Kiểm tra tên miền đã trỏ về máy này và cổng 80, 443 đã mở từ Internet, rồi bấm Thử lại.`);
        }
      },
    });
  }

  steps.push({
    id: 'health',
    title: 'Kiểm tra sức khoẻ',
    detail: 'Mở thử trang đăng nhập và gọi máy chủ',
    run: async () => {
      if (!(await docker.waitHealthy('api', 180_000))) throw new Error('Máy chủ ứng dụng chưa báo khoẻ sau 3 phút. Xem nhật ký bằng "docker compose logs api migrate".');
      const page = await docker.compose(['exec', '-T', 'web', 'wget', '-q', '-O', '-', 'http://127.0.0.1/']);
      if (page.code !== 0) throw new Error('Không mở được trang giao diện.');
      const api = await docker.compose(['exec', '-T', 'web', 'wget', '-q', '-O', '-', 'http://127.0.0.1/api/v1/system/version']);
      if (api.code !== 0) throw new Error('Giao diện không gọi được máy chủ ứng dụng.');
    },
  });

  if (answers.profile === 'saas') {
    steps.push({
      id: 'operator',
      title: 'Tạo người vận hành',
      detail: 'Tài khoản duy nhất vào được khu quản trị nền tảng',
      run: async () => {
        const result = await docker.compose(
          ['run', '--rm', '-T', '-e', 'OPERATOR_USERNAME', '-e', 'OPERATOR_FULL_NAME', '-e', 'OPERATOR_PASSWORD', '-e', 'OPERATOR_TOTP_SECRET', 'migrate', 'pnpm', 'run', 'db:seed:platform-operator'],
          {
            env: {
              OPERATOR_USERNAME: answers.operatorUsername!,
              OPERATOR_FULL_NAME: answers.operatorFullName!,
              OPERATOR_PASSWORD: answers.operatorPassword!,
              OPERATOR_TOTP_SECRET: deps.operatorTotpSecret!,
            },
            timeoutMs: 5 * 60_000,
          },
        );
        if (result.code !== 0) throw new Error(`Không tạo được người vận hành: ${(result.stderr || result.stdout).trim().split(/\r?\n/).pop()}`);
        state.result = { profile: 'saas', publicUrl: plan.publicUrl, username: answers.operatorUsername!, totpSecret: deps.operatorTotpSecret, version: deps.version, plan };
      },
    });
  } else {
    steps.push({
      id: 'clinic',
      title: 'Tạo phòng khám và quản trị viên',
      detail: 'Sinh mật khẩu tạm',
      run: async () => {
        const tempPassword = deps.random.tempPassword();
        const result = await docker.compose(
          ['run', '--rm', '-T', '-e', 'TENANT_NAME', '-e', 'ADMIN_USERNAME', '-e', 'ADMIN_FULL_NAME', '-e', 'ADMIN_PASSWORD', 'migrate', 'pnpm', 'run', 'db:seed:pilot-tenant'],
          {
            env: {
              TENANT_NAME: answers.clinicName!,
              ADMIN_USERNAME: answers.adminUsername!,
              ADMIN_FULL_NAME: answers.adminFullName!,
              ADMIN_PASSWORD: tempPassword,
            },
            timeoutMs: 5 * 60_000,
          },
        );
        if (result.code !== 0) {
          const last = (result.stderr || result.stdout).trim().split(/\r?\n/).pop() ?? '';
          throw new Error(/Đã tồn tại tenant/.test(last) ? 'Phòng khám này đã được tạo ở lần cài trước. Nếu cần cài lại từ đầu, xoá dữ liệu cũ (docker compose down -v) rồi chạy lại.' : `Không tạo được phòng khám: ${last}`);
        }
        // Mật khẩu do trình cài đặt sinh và truyền vào, nên script không in lại (password: null).
        const seeded = parseSeedResult<{ tenantId: string; username: string }>(result.stdout);
        await writeConfigJson(workDir, { ...plan.configJson, tenantId: seeded.tenantId });
        state.result = { profile: answers.profile, publicUrl: plan.publicUrl, username: seeded.username, tempPassword, tenantId: seeded.tenantId, version: deps.version, plan };
      },
    });
  }

  return steps;
}
