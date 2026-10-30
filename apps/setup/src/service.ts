/**
 * Bộ điều phối của trình cài đặt (docs/DECISIONS.md #238): giữ trạng thái một phiên cài/nâng cấp trong bộ nhớ và nối giao diện web với các hàm ở `lib/`.
 * Tách khỏi `server.ts` (HTTP) để test được mà không cần mở cổng mạng.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve4 } from 'node:dns/promises';
import { type CertCheck, checkWildcardCertificate } from './lib/cert';
import { type DnsCheck, checkDomainPointsHere } from './lib/dns';
import type { DockerClient } from './lib/docker';
import { buildHandoffText } from './lib/handoff';
import { buildInstallSteps, type InstallResult } from './lib/install';
import { Job, type JobView } from './lib/job';
import { discoverPackage, hasPlaceholderTenant, readInstalledVersion } from './lib/package-files';
import { type UpgradeReleaseNotes, loadBundledReleaseNotes, notesForUpgrade } from './lib/release-notes';
import { getEnvValue } from './lib/env-file';
import { keyFingerprint } from './lib/key-fingerprint';
import { buildKeyFileText } from './lib/keyfile';
import { type InstallAnswers, buildPlan, validateAnswers } from './lib/profiles';
import { qrSvg } from './lib/qr';
import { generateTempPassword, randomHex } from './lib/secrets';
import { base32Encode, buildOtpAuthUri, groupSecret, verifyTotp } from './lib/totp';
import { type UpgradeRecord, buildManualRollbackSteps, buildUpgradeSteps, readSetupState, writeSetupState } from './lib/upgrade';
import { randomBytes } from 'node:crypto';

export interface SetupEnv {
  workDir: string;
  hostInstallDir: string;
  hostIps: string[];
  /** Phiên bản của chính trình cài đặt (cũng là phiên bản gói). */
  setupVersion: string;
  /** Đường dẫn thư mục cài đặt như người dùng thấy (Windows: `C:\NEXAMed`) — chỉ để hiển thị. */
  hostInstallDirDisplay: string;
}

export type CheckStatus = 'ok' | 'warn' | 'bad';

export interface CheckRow {
  id: string;
  title: string;
  detail: string;
  status: CheckStatus;
  value: string;
  /** Các bước sửa (hiện khi lỗi). */
  fix?: string[];
}

export type Mode = 'install' | 'upgrade';

export interface DetectView {
  mode: Mode;
  setupVersion: string;
  installedVersion: string | null;
  /** Bản mới nhất có trong gói đã giải nén, hoặc null nếu gói thiếu ảnh. */
  packageVersion: string | null;
  services: Array<{ service: string; state: string; health: string }>;
  upToDate: boolean;
  /** Ghi chú của mọi bản từ bản đang chạy đến bản sắp cài (đọc từ thư mục `release-notes/` của gói); `null` khi không nâng cấp hoặc gói không kèm ghi chú. */
  releaseNotes: UpgradeReleaseNotes | null;
  /** Lần cài trước CHƯA xong (đã có `.env` nhưng chưa tạo phòng khám/chưa hoàn tất): chế độ cài mới, nhập lại thông tin để cài tiếp — khoá bí mật cũ được giữ. */
  incompleteInstall: boolean;
  lastUpgrade: UpgradeRecord | null;
  hostInstallDir: string;
  hostIps: string[];
}

export interface DnsDepsFactory {
  (): { resolve4: (d: string) => Promise<string[]>; publicIp: () => Promise<string | null> };
}

const defaultDnsDeps: DnsDepsFactory = () => ({
  resolve4: (domain) => resolve4(domain),
  publicIp: async () => {
    try {
      const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
      const text = (await res.text()).trim();
      return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null;
    } catch {
      return null;
    }
  },
});

export class SetupService {
  private job: Job | null = null;
  private jobKind: 'install' | 'upgrade' | 'rollback' | null = null;
  private installState: { result?: InstallResult } = {};
  private upgradeState: { record?: UpgradeRecord } = {};
  private answers: InstallAnswers | null = null;
  private cert: { crt: string; key: string; check: CertCheck; baseDomain: string } | null = null;
  private otp: { secret: string; verified: boolean } | null = null;
  private acknowledged = false;
  private handoffText: string | null = null;

  constructor(
    private readonly env: SetupEnv,
    private readonly docker: DockerClient,
    private readonly options: { now?: () => Date; sleep?: (ms: number) => Promise<void>; dns?: DnsDepsFactory } = {},
  ) {}

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }

  async detect(): Promise<DetectView> {
    const envVersion = await readInstalledVersion(this.env.workDir);
    const pkg = await discoverPackage(this.env.workDir);
    const packageVersion = pkg.versions[0] ?? null;
    const state = await readSetupState(this.env.workDir);
    // `.env` có phiên bản ngay từ bước "Ghi cấu hình" (bước 2/6) — chưa đủ để coi là đã cài. Lần cài dở: cờ `installInProgress`, hoặc (bản cũ chưa có cờ) `config.json` còn mã phòng khám giữ chỗ.
    const incompleteInstall = envVersion !== null && (state.installInProgress === true || (await hasPlaceholderTenant(this.env.workDir)));
    const installedVersion = incompleteInstall ? null : envVersion;
    const services = installedVersion ? await this.docker.services() : [];
    const releaseNotes = installedVersion ? notesForUpgrade(await loadBundledReleaseNotes(this.env.workDir), installedVersion, packageVersion) : null;
    return {
      mode: installedVersion ? 'upgrade' : 'install',
      incompleteInstall,
      setupVersion: this.env.setupVersion,
      installedVersion,
      packageVersion,
      services,
      upToDate: installedVersion !== null && packageVersion === installedVersion,
      releaseNotes,
      lastUpgrade: state.lastUpgrade && !state.lastUpgrade.rolledBack ? state.lastUpgrade : null,
      hostInstallDir: this.env.hostInstallDirDisplay,
      hostIps: this.env.hostIps,
    };
  }

  /** Bước "Kiểm tra máy". `upgrade` bỏ kiểm tra cổng (hệ thống đang chạy chính là chủ của cổng). */
  async preflight(mode: Mode): Promise<CheckRow[]> {
    const rows: CheckRow[] = [];
    const versions = await this.docker.versions();
    if (!versions) {
      rows.push({
        id: 'docker',
        title: 'Docker',
        detail: 'Trình cài đặt không điều khiển được Docker trên máy này',
        status: 'bad',
        value: 'không dùng được',
        fix: ['Bật Docker và đợi biểu tượng chuyển sang trạng thái đang chạy.', 'Nếu dùng NAS/Linux: tài khoản chạy lệnh phải có quyền dùng Docker.', 'Chạy lại lệnh nexamed-setup.'],
      });
      return rows;
    }
    rows.push({ id: 'docker', title: 'Docker', detail: 'Đang chạy, có Docker Compose', status: 'ok', value: versions.docker });

    const pkg = await discoverPackage(this.env.workDir);
    if (pkg.versions.length === 0) {
      rows.push({
        id: 'images',
        title: 'Ảnh cài đặt',
        detail: 'Không thấy đủ 3 gói (ứng dụng, giao diện, sao lưu) trong thư mục images',
        status: 'bad',
        value: 'thiếu',
        fix: ['Giải nén đầy đủ gói cài đặt NEXAMed vào thư mục này (có thư mục images).', 'Chạy lại lệnh nexamed-setup.'],
      });
    } else {
      rows.push({ id: 'images', title: 'Ảnh cài đặt', detail: 'Đủ 3 gói: ứng dụng, giao diện, sao lưu', status: 'ok', value: `bản ${pkg.versions[0]}` });
    }

    if (mode === 'install') {
      const free80 = await this.docker.portFree(80);
      rows.push(
        free80
          ? { id: 'port80', title: 'Cổng 80', detail: 'Còn trống', status: 'ok', value: 'còn trống' }
          : { id: 'port80', title: 'Cổng 80', detail: 'Đang bị chương trình khác chiếm (thường là IIS trên Windows). Kiểu "Tại phòng khám" có thể dùng cổng 8080 thay thế.', status: 'warn', value: 'dùng 8080' },
      );
    }

    const disk = await this.docker.probeDir(this.env.hostInstallDir);
    if (disk.ok) {
      const free = disk.freeGb ?? 0;
      rows.push({
        id: 'disk',
        title: 'Dung lượng ổ đĩa',
        detail: free >= 20 ? `Còn ${Math.round(free)} GB, đủ cho dữ liệu nhiều năm` : `Chỉ còn ${Math.round(free)} GB, nên có ít nhất 20 GB`,
        status: free >= 20 ? 'ok' : free >= 5 ? 'warn' : 'bad',
        value: `${Math.round(free)} GB`,
      });
    } else {
      rows.push({ id: 'disk', title: 'Dung lượng ổ đĩa', detail: 'Không ghi được vào thư mục cài đặt', status: 'bad', value: 'lỗi', fix: [disk.error ?? 'Kiểm tra quyền ghi của thư mục cài đặt.'] });
    }

    const mem = await this.docker.memoryGb();
    if (mem !== null) {
      rows.push({ id: 'memory', title: 'Bộ nhớ', detail: mem >= 4 ? `${mem.toFixed(0)} GB RAM` : `Chỉ ${mem.toFixed(1)} GB RAM cho Docker, khuyến nghị từ 4 GB`, status: mem >= 4 ? 'ok' : 'warn', value: `${mem >= 4 ? mem.toFixed(0) : mem.toFixed(1)} GB` });
    }
    return rows;
  }

  async checkPort(port: number): Promise<CheckRow> {
    const free = await this.docker.portFree(port);
    return { id: `port${port}`, title: `Cổng ${port}`, detail: free ? 'Còn trống' : 'Đang bị chương trình khác chiếm', status: free ? 'ok' : 'bad', value: free ? 'còn trống' : 'bị chiếm' };
  }

  /** Thư mục sao lưu: ghi được không, ổ còn bao nhiêu. Đường dẫn đã đổi sang dạng Compose hiểu. */
  async checkBackupDir(hostPath: string): Promise<CheckRow> {
    const probe = await this.docker.probeDir(hostPath);
    if (!probe.ok) return { id: 'backup', title: 'Thư mục sao lưu', detail: `Không ghi được: ${probe.error ?? 'không rõ lý do'}`, status: 'bad', value: 'lỗi' };
    return { id: 'backup', title: 'Thư mục sao lưu', detail: 'Ghi được', status: 'ok', value: probe.freeGb !== undefined ? `${Math.round(probe.freeGb)} GB trống` : 'ghi được' };
  }

  async checkDns(domain: string): Promise<DnsCheck> {
    return checkDomainPointsHere(domain, this.env.hostIps, (this.options.dns ?? defaultDnsDeps)());
  }

  checkCertificate(crtPem: string, keyPem: string, baseDomain: string): CertCheck {
    const check = checkWildcardCertificate(crtPem, keyPem, baseDomain, this.now());
    if (check.ok) this.cert = { crt: crtPem, key: keyPem, check, baseDomain };
    else this.cert = null;
    return check;
  }

  validate(raw: Parameters<typeof validateAnswers>[0]) {
    return validateAnswers(raw);
  }

  /** Bảng "Xem lại" cho giao diện (từ câu trả lời đã chuẩn hoá). */
  review(answers: InstallAnswers) {
    const plan = buildPlan(answers);
    return { summary: [...plan.summary, ['Phiên bản', `NEXAMed ${this.env.setupVersion}`] as [string, string]], publicUrl: plan.publicUrl };
  }

  jobView(): (JobView & { kind: 'install' | 'upgrade' | 'rollback' }) | null {
    return this.job && this.jobKind ? { ...this.job.view(), kind: this.jobKind } : null;
  }

  /**
   * Bắt đầu cài mới, hoặc (`retry`) tiếp tục lần cài vừa lỗi. Câu trả lời đã được kiểm tra lại ở đây — không tin giao diện.
   * Chỉ nút "Thử lại" (`retry: true`) mới dùng lại câu trả lời CŨ; gửi câu trả lời mới (sau "Sửa thông tin", ví dụ đổi cổng vì cổng cũ bị chiếm) luôn dựng chuỗi bước mới từ câu trả lời đó —
   * trước đây mọi lần gửi sau một lần lỗi đều bị coi là "thử lại" nên cổng mới bị bỏ qua. Dựng lại vẫn an toàn: `.env` đã có thì giữ nguyên khoá bí mật, các bước đều chạy lại được.
   */
  startInstall(raw: Parameters<typeof validateAnswers>[0], options: { retry?: boolean } = {}): { ok: true } | { ok: false; errors: Record<string, string> } {
    if (options.retry) {
      if (this.job && this.jobKind === 'install' && this.job.view().state === 'failed' && this.answers) {
        this.runInstallJob(this.job);
        return { ok: true };
      }
      return { ok: false, errors: { _: 'Chưa có lần cài nào vừa lỗi để thử lại.' } };
    }
    if (this.job?.view().state === 'running') return { ok: false, errors: { _: 'Đang cài, vui lòng chờ.' } };
    const checked = validateAnswers(raw);
    if (!checked.ok) return checked;
    const answers = checked.value;
    if (answers.profile === 'saas') {
      if (!this.cert || this.cert.baseDomain !== answers.domain) return { ok: false, errors: { certificate: 'Tải lên chứng chỉ wildcard (.crt và .key) hợp lệ cho tên miền này.' } };
      // Dựng lại sau một lần lỗi thì giữ bí mật OTP đã sinh (có thể đã nạp vào tài khoản vận hành ở bước trước).
      this.otp ??= { secret: base32Encode(randomBytes(20)), verified: false };
    }
    this.answers = answers;
    this.installState = {};
    this.acknowledged = false;
    this.handoffText = null;
    const steps = buildInstallSteps(
      answers,
      {
        docker: this.docker,
        workDir: this.env.workDir,
        version: this.env.setupVersion,
        random: { hex: randomHex, tempPassword: generateTempPassword },
        cert: this.cert ? { crt: this.cert.crt, key: this.cert.key } : undefined,
        operatorTotpSecret: this.otp?.secret,
        sleep: this.options.sleep,
      },
      this.installState,
    );
    this.job = new Job(steps);
    this.jobKind = 'install';
    this.runInstallJob(this.job);
    return { ok: true };
  }

  /** Chạy chuỗi cài và ghi nhận "đang cài dở" trong `.setup-state.json`: xoá cờ khi MỌI bước xong; lỗi/đóng giữa chừng thì cờ còn, lần mở sau cho cài tiếp. */
  private runInstallJob(job: Job): void {
    // `job.run()` PHẢI được gọi ngay (đồng bộ) để trạng thái chuyển sang "running" trước khi giao diện hỏi lần đầu: giao diện coi mọi trạng thái khác "running"/"done" là đã kết thúc và ngừng hỏi,
    // nên nếu chờ ghi cờ xong mới chạy thì trang đứng im ở bước đầu dù việc cài vẫn chạy ngầm (lỗi 24/10/2026, #261).
    const finished = job.run();
    void (async () => {
      const state = await readSetupState(this.env.workDir);
      await writeSetupState(this.env.workDir, { ...state, installInProgress: true }).catch(() => undefined);
      await finished;
      if (job.view().state === 'done') {
        await writeSetupState(this.env.workDir, { ...(await readSetupState(this.env.workDir)), installInProgress: false }).catch(() => undefined);
      }
    })();
  }

  startUpgrade(): { ok: true } | { ok: false; error: string } {
    if (this.job?.view().state === 'running') return { ok: false, error: 'Đang chạy, vui lòng chờ.' };
    if (this.job && this.jobKind === 'upgrade' && this.job.view().state === 'failed') {
      void this.job.run();
      return { ok: true };
    }
    return { ok: false, error: 'Chưa có phiên nâng cấp nào để thử lại.' };
  }

  /** Dựng và chạy chuỗi nâng cấp từ bản đang cài lên bản mới nhất của gói. */
  async beginUpgrade(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.job?.view().state === 'running') return { ok: false, error: 'Đang chạy, vui lòng chờ.' };
    const detail = await this.detect();
    if (!detail.installedVersion || !detail.packageVersion) return { ok: false, error: 'Không xác định được phiên bản đang chạy hoặc bản mới trong gói.' };
    if (detail.upToDate) return { ok: false, error: 'Hệ thống đã là bản mới nhất.' };
    this.upgradeState = {};
    const steps = buildUpgradeSteps(detail.installedVersion, detail.packageVersion, { docker: this.docker, workDir: this.env.workDir, now: () => this.now(), sleep: this.options.sleep }, this.upgradeState);
    this.job = new Job(steps);
    this.jobKind = 'upgrade';
    void this.job.run();
    return { ok: true };
  }

  async beginRollback(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.job?.view().state === 'running') return { ok: false, error: 'Đang chạy, vui lòng chờ.' };
    const { lastUpgrade } = await readSetupState(this.env.workDir);
    if (!lastUpgrade || lastUpgrade.rolledBack) return { ok: false, error: 'Không có lần nâng cấp nào để quay lui.' };
    this.job = new Job(buildManualRollbackSteps(lastUpgrade, { docker: this.docker, workDir: this.env.workDir, now: () => this.now() }));
    this.jobKind = 'rollback';
    void this.job.run();
    return { ok: true };
  }

  /** Dữ liệu cho bước "Kích hoạt OTP" (SaaS). */
  otpView(): { secretSpaced: string; otpauth: string; qrSvg: string; verified: boolean } | null {
    if (!this.otp || !this.answers?.operatorUsername) return null;
    const otpauth = buildOtpAuthUri(this.otp.secret, this.answers.operatorUsername);
    return { secretSpaced: groupSecret(this.otp.secret), otpauth, qrSvg: qrSvg(otpauth), verified: this.otp.verified };
  }

  verifyOtp(code: string): boolean {
    if (!this.otp) return false;
    const ok = verifyTotp(this.otp.secret, code, this.now().getTime());
    if (ok) this.otp.verified = true;
    return ok;
  }

  /** Kết quả cuối (địa chỉ, tài khoản, mật khẩu tạm). Mật khẩu tạm chỉ còn trong bộ nhớ tới khi người cài xác nhận "đã lưu" (`acknowledge`). */
  takeResult(): { publicUrl: string; username: string; tempPassword: string | null; profile: InstallAnswers['profile']; version: string; clinicName?: string; tenantId?: string } | null {
    const result = this.installState.result;
    if (!result || this.jobKind !== 'install' || this.job?.view().state !== 'done' || !this.answers) return null;
    if (result.tempPassword === undefined && result.profile !== 'saas') return null;
    const view = {
      publicUrl: result.publicUrl,
      username: result.username,
      tempPassword: result.tempPassword ?? null,
      profile: result.profile,
      version: result.version,
      clinicName: this.answers.clinicName,
      tenantId: result.tenantId,
    };
    if (!this.handoffText) {
      this.handoffText = buildHandoffText({
        profile: result.profile,
        version: result.version,
        publicUrl: result.publicUrl,
        username: result.username,
        tempPassword: result.tempPassword,
        clinicName: this.answers.clinicName,
        backupDir: this.answers.backupDir,
        backupHourVn: this.answers.backupHourVn,
        retentionDays: this.answers.backupRetentionDays ?? 14,
        installDir: this.env.hostInstallDirDisplay,
        createdAt: this.now(),
      });
    }
    return view;
  }

  /** Xoá mật khẩu tạm khỏi bộ nhớ sau khi người cài đã xác nhận "đã lưu". */
  acknowledge(): void {
    this.acknowledged = true;
    this.handoffText = null;
    if (this.installState.result) this.installState.result.tempPassword = undefined;
  }

  /**
   * Khoá mã hoá hệ thống vừa được sinh (đọc từ `.env`) để trang "Hoàn tất" hiện mã kiểm và cho tải FILE KHOÁ (#262). Chỉ có khi lần cài đã xong; luôn trả được (không tự xoá như mật khẩu tạm) vì khoá
   * nằm trong `.env` suốt đời hệ thống — file này chỉ là bản để cất riêng.
   */
  async keyInfo(): Promise<{ fingerprint: string; text: string } | null> {
    const result = this.installState.result;
    if (!result || this.jobKind !== 'install' || this.job?.view().state !== 'done') return null;
    let key: string | null = null;
    try {
      key = getEnvValue(await readFile(join(this.env.workDir, '.env'), 'utf8'), 'ENCRYPTION_KEY') ?? null;
    } catch {
      key = null;
    }
    if (!key) return null;
    return {
      fingerprint: keyFingerprint(key),
      text: buildKeyFileText({ key, version: result.version, publicUrl: result.publicUrl, clinicName: this.answers?.clinicName, createdAt: this.now() }),
    };
  }

  isAcknowledged(): boolean {
    return this.acknowledged;
  }

  handoff(): string | null {
    return this.handoffText;
  }
}
