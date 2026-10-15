/**
 * Chạy lệnh ngoài (docker, docker compose) qua một giao diện nhỏ để test thay bằng bản giả — mã cài đặt/nâng cấp KHÔNG gọi `child_process` trực tiếp.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export interface RunOptions {
  /** Biến môi trường thêm cho tiến trình con (không in ra log). */
  env?: Record<string, string>;
  /** Hạn chót tính bằng mili-giây; quá hạn thì dừng tiến trình và trả mã lỗi 124. */
  timeoutMs?: number;
  /** Ghi thẳng đầu ra chuẩn vào file (dùng cho `pg_dump -Fc`, đầu ra nhị phân); khi đó `stdout` trả về rỗng. */
  stdoutFile?: string;
  /** Nhận từng dòng đầu ra (cả stdout và stderr) để hiện nhật ký tiến độ. */
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Shell {
  run(command: string, args: string[], options?: RunOptions): Promise<RunResult>;
}

export class NodeShell implements Shell {
  run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(command, args, { env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ code: 127, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
        return;
      }
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const fileStream = options.stdoutFile ? createWriteStream(options.stdoutFile) : null;
      let timedOut = false;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : null;
      const emitLines = (chunk: Buffer, carry: { text: string }) => {
        if (!options.onLine) return;
        carry.text += chunk.toString('utf8');
        const parts = carry.text.split(/\r?\n/);
        carry.text = parts.pop() ?? '';
        for (const line of parts) if (line.trim()) options.onLine(line);
      };
      const outCarry = { text: '' };
      const errCarry = { text: '' };
      child.stdout.on('data', (chunk: Buffer) => {
        if (fileStream) fileStream.write(chunk);
        else {
          out.push(chunk);
          emitLines(chunk, outCarry);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err.push(chunk);
        emitLines(chunk, errCarry);
      });
      child.on('error', (e) => {
        if (timer) clearTimeout(timer);
        fileStream?.end();
        resolve({ code: 127, stdout: '', stderr: e.message });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        const finish = () => resolve({ code: timedOut ? 124 : (code ?? 1), stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
        if (fileStream) fileStream.end(finish);
        else finish();
      });
    });
  }
}
