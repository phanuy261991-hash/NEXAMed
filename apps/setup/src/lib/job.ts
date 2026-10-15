/**
 * Một lần cài/nâng cấp chạy thành chuỗi bước có trạng thái, để giao diện hiện tiến độ từng bước (docs/DECISIONS.md #238).
 * Bước lỗi thì dừng cả chuỗi và giữ thông báo để hiện cho người cài; kết quả nhạy cảm (mật khẩu tạm, bí mật OTP) chỉ nằm trong bộ nhớ của tiến trình.
 */
export type StepStatus = 'wait' | 'run' | 'ok' | 'bad';

export interface StepView {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
  /** Ghi chú ngắn sau khi chạy (ví dụ "đã có sẵn, bỏ qua"). */
  note?: string;
}

export interface StepContext {
  log: (line: string) => void;
  note: (text: string) => void;
}

export interface StepDef {
  id: string;
  title: string;
  detail: string;
  run: (ctx: StepContext) => Promise<void>;
}

export type JobState = 'idle' | 'running' | 'done' | 'failed';

export interface JobView {
  state: JobState;
  steps: StepView[];
  percent: number;
  log: string[];
  error: string | null;
}

const MAX_LOG_LINES = 300;

/** Dòng nhật ký có thể chứa bí mật (đầu ra của lệnh tạo tài khoản) thì không đưa lên giao diện. */
const SENSITIVE_LINE = /NEXAMED_RESULT|mật khẩu|password|otpauth|bí mật|secret/i;

export class Job {
  private state: JobState = 'idle';
  private readonly steps: StepView[];
  private readonly defs: StepDef[];
  private readonly logLines: string[] = [];
  private errorText: string | null = null;

  constructor(defs: StepDef[]) {
    this.defs = defs;
    this.steps = defs.map((d) => ({ id: d.id, title: d.title, detail: d.detail, status: 'wait' as StepStatus }));
  }

  view(): JobView {
    const done = this.steps.filter((s) => s.status === 'ok').length;
    return {
      state: this.state,
      steps: this.steps.map((s) => ({ ...s })),
      percent: this.steps.length === 0 ? 100 : Math.round((done / this.steps.length) * 100),
      log: [...this.logLines],
      error: this.errorText,
    };
  }

  private push(line: string): void {
    if (SENSITIVE_LINE.test(line)) return;
    this.logLines.push(line.slice(0, 500));
    if (this.logLines.length > MAX_LOG_LINES) this.logLines.shift();
  }

  /** Chạy lần lượt các bước; không ném lỗi — lỗi nằm ở `view().error`. */
  async run(): Promise<void> {
    if (this.state === 'running') return;
    this.state = 'running';
    this.errorText = null;
    for (let i = 0; i < this.defs.length; i += 1) {
      const def = this.defs[i]!;
      const view = this.steps[i]!;
      if (view.status === 'ok') continue;
      view.status = 'run';
      view.note = undefined;
      try {
        await def.run({ log: (line) => this.push(line), note: (text) => (view.note = text) });
        view.status = 'ok';
      } catch (err) {
        view.status = 'bad';
        this.errorText = err instanceof Error ? err.message : String(err);
        this.push(`LỖI: ${this.errorText}`);
        this.state = 'failed';
        return;
      }
    }
    this.state = 'done';
  }
}
