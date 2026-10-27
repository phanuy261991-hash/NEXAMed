/**
 * Bọc `docker` và `docker compose` (docs/DECISIONS.md #238). Trình cài đặt chạy TRONG container, điều khiển Docker của máy qua docker.sock:
 *  - đọc/ghi file ở `/work` (thư mục cài đặt được gắn vào container);
 *  - nhưng bind-mount trong compose phải theo đường dẫn THẬT trên máy (`HOST_INSTALL_DIR`), nên chạy compose với `--project-directory <đường dẫn máy>`
 *    và `-f /work/docker-compose.yml` (đọc file qua đường dẫn trong container).
 * KHÔNG đặt `-p`: tên dự án lấy theo tên thư mục cài đặt như các lần cài bằng script `install.*` cũ (đã bỏ), nếu không volume dữ liệu cũ sẽ không được nhận ra.
 */
import type { RunOptions, RunResult, Shell } from './shell';

export interface DockerConfig {
  /** Thư mục cài đặt nhìn từ trong container (`/work`). */
  workDir: string;
  /** Cùng thư mục đó nhìn từ máy chủ (Windows đã đổi sang dạng `/c/Users/...`). */
  hostInstallDir: string;
  /** Ảnh dùng để chạy container thăm dò ngắn (ảnh của chính trình cài đặt — luôn có sẵn trên máy). */
  probeImage: string;
}

export interface ServiceState {
  service: string;
  state: string;
  health: string;
}

export interface DirProbe {
  ok: boolean;
  freeGb?: number;
  error?: string;
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DockerClient {
  constructor(
    private readonly shell: Shell,
    private readonly config: DockerConfig,
    private readonly sleep: Sleep = realSleep,
  ) {}

  private docker(args: string[], options?: RunOptions): Promise<RunResult> {
    return this.shell.run('docker', args, options);
  }

  composeArgs(): string[] {
    return ['compose', '--project-directory', this.config.hostInstallDir, '-f', `${this.config.workDir}/docker-compose.yml`, '--env-file', `${this.config.workDir}/.env`];
  }

  compose(args: string[], options?: RunOptions): Promise<RunResult> {
    return this.docker([...this.composeArgs(), ...args], options);
  }

  /** Phiên bản Docker và Compose, hoặc `null` nếu Docker không dùng được. */
  async versions(): Promise<{ docker: string; compose: string } | null> {
    const server = await this.docker(['version', '--format', '{{.Server.Version}}']);
    if (server.code !== 0 || !server.stdout.trim()) return null;
    const compose = await this.docker(['compose', 'version', '--short']);
    if (compose.code !== 0) return null;
    return { docker: server.stdout.trim(), compose: compose.stdout.trim() };
  }

  async memoryGb(): Promise<number | null> {
    const result = await this.docker(['info', '--format', '{{.MemTotal}}']);
    const bytes = Number(result.stdout.trim());
    return result.code === 0 && Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 ** 3 : null;
  }

  async imageExists(ref: string): Promise<boolean> {
    return (await this.docker(['image', 'inspect', ref, '--format', '{{.Id}}'])).code === 0;
  }

  async loadImage(file: string, onLine?: (line: string) => void): Promise<void> {
    const result = await this.docker(['load', '-i', file], { onLine, timeoutMs: 20 * 60_000 });
    if (result.code !== 0) throw new Error(`Không nạp được ảnh ${file}: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  /** Trạng thái các dịch vụ của hệ thống đang cài (rỗng nếu chưa chạy dịch vụ nào). */
  async services(): Promise<ServiceState[]> {
    const result = await this.compose(['ps', '--all', '--format', 'json']);
    if (result.code !== 0) return [];
    const rows: ServiceState[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { Service?: string; State?: string; Health?: string };
        if (parsed.Service) rows.push({ service: parsed.Service, state: parsed.State ?? '', health: parsed.Health ?? '' });
      } catch {
        // Bản Compose cũ in một mảng JSON cho cả đầu ra — thử đọc cả khối.
        try {
          const arr = JSON.parse(result.stdout) as Array<{ Service?: string; State?: string; Health?: string }>;
          return arr.filter((r) => r.Service).map((r) => ({ service: r.Service!, state: r.State ?? '', health: r.Health ?? '' }));
        } catch {
          return rows;
        }
      }
    }
    return rows;
  }

  /** Chờ dịch vụ có healthcheck báo `healthy`. Trả về `true` nếu đạt trong thời hạn. */
  async waitHealthy(service: string, timeoutMs: number, onTick?: () => void): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await this.services();
      const row = rows.find((r) => r.service === service);
      if (row?.health === 'healthy') return true;
      if (row && (row.state === 'exited' || row.state === 'dead')) return false;
      if (Date.now() >= deadline) return false;
      onTick?.();
      await this.sleep(3000);
    }
  }

  /** Chờ đến khi nhật ký của dịch vụ có đoạn cần tìm (ví dụ Caddy báo đã lấy được chứng chỉ). */
  async waitForLog(service: string, pattern: RegExp, timeoutMs: number): Promise<{ found: boolean; tail: string }> {
    const deadline = Date.now() + timeoutMs;
    let tail = '';
    for (;;) {
      const result = await this.compose(['logs', '--no-color', '--tail', '200', service]);
      tail = (result.stdout + result.stderr).trim();
      if (pattern.test(tail)) return { found: true, tail };
      if (Date.now() >= deadline) return { found: false, tail };
      await this.sleep(3000);
    }
  }

  /** Chạy một container ngắn từ ảnh thăm dò, KHÔNG dùng entrypoint của ảnh. */
  private probe(args: string[], command: string[]): Promise<RunResult> {
    return this.docker(['run', '--rm', '--entrypoint', command[0]!, ...args, this.config.probeImage, ...command.slice(1)], { timeoutMs: 60_000 });
  }

  /**
   * Cổng của máy còn trống không (thử gắn cổng bằng container thăm dò — container cài đặt không tự thấy cổng của máy).
   * PHẢI gắn kèm địa chỉ IP (`0.0.0.0:<cổng>:80`) giống cách `docker-compose.yml` mở cổng web (`${WEB_BIND_IP}:${WEB_HTTP_PORT}:80`): trên Docker Desktop (Windows)
   * `-p <cổng>:80` trần KHÔNG phát hiện cổng đã bị chương trình khác (Apache/XAMPP, IIS) giữ, còn gắn kèm IP thì lỗi đúng như lúc khởi động thật (đo 24/10/2026, #261).
   */
  async portFree(port: number, bindIp = '0.0.0.0'): Promise<boolean> {
    const result = await this.probe(['-p', `${bindIp}:${port}:80`], ['/bin/true']);
    return result.code === 0;
  }

  /** Thư mục (đường dẫn máy) ghi được không, còn bao nhiêu GB trống. Thư mục chưa có thì Docker tự tạo. */
  async probeDir(hostPath: string): Promise<DirProbe> {
    const write = await this.probe(['-v', `${hostPath}:/probe`], ['/bin/sh', '-c', 'touch /probe/.nexamed-write-test && rm -f /probe/.nexamed-write-test && df -Pk /probe | tail -1']);
    if (write.code !== 0) return { ok: false, error: (write.stderr || write.stdout).trim().split(/\r?\n/).pop() };
    const cols = write.stdout.trim().split(/\s+/);
    const freeKb = Number(cols[3]);
    return { ok: true, freeGb: Number.isFinite(freeKb) ? freeKb / 1024 / 1024 : undefined };
  }
}
