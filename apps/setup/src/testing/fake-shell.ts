import { writeFile } from 'node:fs/promises';
import type { RunOptions, RunResult, Shell } from '../lib/shell';

export interface Call {
  command: string;
  args: string[];
  options?: RunOptions;
  /** Dòng lệnh đã nối, để so khớp bằng `includes`/regex trong test. */
  line: string;
}

export type Handler = (call: Call) => Partial<RunResult> | undefined | Promise<Partial<RunResult> | undefined>;

/** Shell giả: ghi lại mọi lệnh gọi; `handlers` (kiểm tra theo thứ tự) trả kết quả, mặc định thành công với đầu ra rỗng. */
export class FakeShell implements Shell {
  readonly calls: Call[] = [];
  constructor(private readonly handlers: Handler[] = []) {}

  async run(command: string, args: string[], options?: RunOptions): Promise<RunResult> {
    const call: Call = { command, args, options, line: [command, ...args].join(' ') };
    this.calls.push(call);
    for (const handler of this.handlers) {
      const result = await handler(call);
      if (result) {
        if (options?.stdoutFile && result.stdout) await writeFile(options.stdoutFile, result.stdout);
        return { code: 0, stdout: '', stderr: '', ...result };
      }
    }
    if (options?.stdoutFile) await writeFile(options.stdoutFile, 'DUMP');
    return { code: 0, stdout: '', stderr: '' };
  }

  /** Các lệnh `docker compose ...` đã gọi, chỉ phần sau cờ cấu hình chung (`--env-file <file>`). */
  composeCalls(): string[] {
    return this.calls
      .filter((c) => c.args[0] === 'compose')
      .map((c) => {
        const i = c.args.indexOf('--env-file');
        return c.args.slice(i + 2).join(' ');
      });
  }
}

export function psJson(rows: Array<{ Service: string; State?: string; Health?: string }>): string {
  return rows.map((r) => JSON.stringify({ State: 'running', Health: '', ...r })).join('\n');
}
