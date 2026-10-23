/**
 * Từ câu trả lời của người cài sinh ra mọi file cấu hình (docs/DECISIONS.md #238): `.env`, `config.json`, Caddyfile, hàng tóm tắt "Xem lại".
 * Hàm thuần — không đọc đĩa, không gọi Docker — để test được hết các biến thể (LAN / VPS / SaaS).
 */
import {
  type Validation,
  assessPassword,
  validateBackupDir,
  validateDomain,
  validateEmail,
  validateHour,
  validateLanAddress,
  validatePort,
  validateRequiredText,
  validateUsername,
} from './validators';

export type Profile = 'lan' | 'vps' | 'saas';

export const PROFILE_LABEL: Record<Profile, string> = {
  lan: 'Tại phòng khám',
  vps: 'VPS riêng của khách',
  saas: 'Hệ thống SaaS',
};

export interface InstallAnswers {
  profile: Profile;
  /** LAN: IP trong mạng nội bộ nhân viên dùng để vào, hoặc `localhost` (chỉ máy này). */
  lanAddress?: string;
  /** LAN: cổng HTTP trên máy (80, hoặc 8080 khi cổng 80 bị chiếm). */
  webPort?: number;
  /** VPS: tên miền của phòng khám. SaaS: tên miền GỐC của hệ thống (công ty khách là `<mã>.<tên miền gốc>`). */
  domain?: string;
  /** VPS: email nhận thông báo chứng chỉ. */
  acmeEmail?: string;
  /** LAN/VPS: phòng khám và quản trị viên đầu tiên. */
  clinicName?: string;
  adminFullName?: string;
  adminUsername?: string;
  /** SaaS: người vận hành. */
  operatorFullName?: string;
  operatorUsername?: string;
  operatorPassword?: string;
  /** Thư mục sao lưu TRÊN MÁY (đường dẫn người dùng thấy), giờ chạy theo giờ Việt Nam (0-23), số ngày giữ. */
  backupDir: string;
  backupHourVn: number;
  backupRetentionDays?: number;
}

export interface InstallPlan {
  /** Các khoá cần ghi/đè vào `.env` (bí mật hệ thống sinh riêng ở bước cài, không nằm ở đây). */
  env: Record<string, string>;
  /** `config.json` của giao diện web (`apiBaseUrl` luôn để trống = cùng nguồn gốc); `tenantId` điền sau khi tạo phòng khám (LAN/VPS), KHÔNG có ở SaaS. */
  configJson: { apiBaseUrl: string; tenantId?: string };
  /** Nội dung Caddyfile (VPS/SaaS) hoặc `null` (LAN không dùng Caddy). */
  caddyfile: string | null;
  /** Địa chỉ mà người dùng sẽ mở để đăng nhập (SaaS: khu quản trị). */
  publicUrl: string;
  /** Các hàng của bảng "Xem lại": [nhãn, giá trị]. */
  summary: Array<[string, string]>;
  /** Cổng/địa chỉ web cần kiểm tra ở bước "Kiểm tra máy". */
  requiredPorts: number[];
}

export const DEFAULT_RETENTION_DAYS = 14;
export const SAAS_ADMIN_SUBDOMAIN = 'admin';
/** Giờ Việt Nam là UTC+7 cố định, không đổi giờ mùa hè. */
const VN_UTC_OFFSET_HOURS = 7;

/** `BACKUP_HOUR` của container sao lưu là giờ UTC; người cài nhập theo giờ Việt Nam. */
export function vnHourToUtc(hourVn: number): number {
  return (((hourVn - VN_UTC_OFFSET_HOURS) % 24) + 24) % 24;
}

export function utcHourToVn(hourUtc: number): number {
  return (hourUtc + VN_UTC_OFFSET_HOURS) % 24;
}

/**
 * Đường dẫn thư mục sao lưu viết vào `.env` cho Docker Compose. Docker Desktop (Windows) chỉ nhận dạng `/d/NEXAMed-backup` khi Compose chạy từ trong container
 * (dạng `D:\...` làm Compose hiểu nhầm là đường dẫn tương đối); đường dẫn Linux/NAS giữ nguyên. UNC (`\\máy\thư-mục`) đổi dấu gạch.
 */
export function backupDirForCompose(input: string): string {
  const drive = /^([A-Za-z]):[\\/]*(.*)$/.exec(input);
  if (drive) return `/${drive[1]!.toLowerCase()}/${drive[2]!.replace(/\\/g, '/')}`.replace(/\/+$/, '') || `/${drive[1]!.toLowerCase()}`;
  if (input.startsWith('\\\\')) return input.replace(/\\/g, '/');
  return input.replace(/\/+$/, '') || '/';
}

export function saasWildcardNames(baseDomain: string): { wildcard: string; apex: string } {
  return { wildcard: `*.${baseDomain}`, apex: baseDomain };
}

function lanOrigin(address: string, port: number): string {
  return `http://${address}${port === 80 ? '' : `:${port}`}`;
}

/**
 * Tiêu đề HSTS (docs/DECISIONS.md #252): 180 ngày, CHƯA `includeSubDomains`/`preload` — khó gỡ khi đã gửi
 * (tên miền gốc còn dùng cho khu quản trị nền tảng), nâng dần sau khi chạy ổn định.
 */
export const HSTS_HEADER = 'header Strict-Transport-Security "max-age=15552000"';

export function buildCaddyfile(profile: 'vps' | 'saas', domain: string, acmeEmail?: string): string {
  const lines: string[] = [];
  lines.push('# Do trình cài đặt NEXAMed sinh ra (docs/DECISIONS.md #238). Caddy giữ nguyên tiêu đề Host nên ứng dụng nhận ra đúng công ty theo tên miền.');
  if (profile === 'vps') {
    lines.push('{', `\temail ${acmeEmail}`, '}', '', `${domain} {`, `\t${HSTS_HEADER}`, '\treverse_proxy web:80', '}');
  } else {
    lines.push(`https://*.${domain}, https://${domain} {`, '\ttls /certs/fullchain.crt /certs/privkey.key', `\t${HSTS_HEADER}`, '\treverse_proxy web:80', '}');
  }
  return lines.join('\n') + '\n';
}

export function buildPlan(answers: InstallAnswers): InstallPlan {
  const backup = backupDirForCompose(answers.backupDir);
  const backupEnv: Record<string, string> = {
    BACKUP_HOST_DIR: backup,
    BACKUP_DIR_DISPLAY: answers.backupDir,
    BACKUP_HOUR: String(vnHourToUtc(answers.backupHourVn)),
    BACKUP_RETENTION_DAYS: String(answers.backupRetentionDays ?? DEFAULT_RETENTION_DAYS),
  };
  const backupSummary = `${answers.backupDir}, ${String(answers.backupHourVn).padStart(2, '0')}:00 hằng ngày, giữ ${answers.backupRetentionDays ?? DEFAULT_RETENTION_DAYS} ngày`;

  if (answers.profile === 'lan') {
    const address = answers.lanAddress ?? 'localhost';
    const port = answers.webPort ?? 80;
    const origin = lanOrigin(address, port);
    return {
      env: {
        DEPLOYMENT_MODE: 'single',
        WEB_ORIGIN: origin,
        WEB_HTTP_PORT: String(port),
        // "Chỉ trên máy này" thì không mở cổng ra mạng nội bộ.
        WEB_BIND_IP: address === 'localhost' ? '127.0.0.1' : '0.0.0.0',
        // Máy trạm → nginx → API: đúng MỘT lớp proxy, nên máy chủ đọc được IP thật của từng máy trạm (#244).
        TRUST_PROXY_HOPS: '1',
        COOKIE_SECURE: 'false',
        COMPOSE_PROFILES: '',
        PLATFORM_BASE_DOMAIN: '',
        ...backupEnv,
      },
      // Bỏ trống = giao diện gọi máy chủ qua CHÍNH địa chỉ đang mở (cùng nguồn gốc, nginx chuyển /api). Nhờ vậy IP máy đổi (router không giữ IP cố định) ứng dụng vẫn chạy, nhân viên chỉ cần mở địa chỉ mới.
      configJson: { apiBaseUrl: '' },
      caddyfile: null,
      publicUrl: origin,
      requiredPorts: [port],
      summary: [
        ['Kiểu triển khai', PROFILE_LABEL.lan],
        ['Địa chỉ truy cập', origin],
        ['Phòng khám', answers.clinicName ?? ''],
        ['Quản trị viên', `${answers.adminFullName ?? ''} (${answers.adminUsername ?? ''})`],
        ['Sao lưu', backupSummary],
      ],
    };
  }

  const domain = answers.domain ?? '';
  if (answers.profile === 'vps') {
    const origin = `https://${domain}`;
    return {
      env: {
        DEPLOYMENT_MODE: 'single',
        WEB_ORIGIN: origin,
        // Web chỉ nghe nội bộ; Caddy là cửa ngõ duy nhất ra Internet.
        WEB_HTTP_PORT: '8081',
        WEB_BIND_IP: '127.0.0.1',
        // Máy trạm → Caddy (HTTPS) → nginx → API: HAI lớp proxy (#244).
        TRUST_PROXY_HOPS: '2',
        COOKIE_SECURE: 'true',
        COMPOSE_PROFILES: 'https',
        PLATFORM_BASE_DOMAIN: '',
        ...backupEnv,
      },
      // Bỏ trống = giao diện gọi máy chủ qua CHÍNH địa chỉ đang mở (cùng nguồn gốc, nginx chuyển /api). Nhờ vậy IP máy đổi (router không giữ IP cố định) ứng dụng vẫn chạy, nhân viên chỉ cần mở địa chỉ mới.
      configJson: { apiBaseUrl: '' },
      caddyfile: buildCaddyfile('vps', domain, answers.acmeEmail),
      publicUrl: origin,
      requiredPorts: [80, 443],
      summary: [
        ['Kiểu triển khai', PROFILE_LABEL.vps],
        ['Địa chỉ truy cập', origin],
        ['Chứng chỉ HTTPS', `Tự xin và gia hạn cho ${domain} (email ${answers.acmeEmail ?? ''})`],
        ['Phòng khám', answers.clinicName ?? ''],
        ['Quản trị viên', `${answers.adminFullName ?? ''} (${answers.adminUsername ?? ''})`],
        ['Sao lưu', backupSummary],
      ],
    };
  }

  const origin = `https://${SAAS_ADMIN_SUBDOMAIN}.${domain}`;
  return {
    env: {
      DEPLOYMENT_MODE: 'saas',
      PLATFORM_BASE_DOMAIN: domain,
      PLATFORM_ADMIN_SUBDOMAIN: SAAS_ADMIN_SUBDOMAIN,
      WEB_ORIGIN: origin,
      WEB_HTTP_PORT: '8081',
      WEB_BIND_IP: '127.0.0.1',
      // Máy trạm → Caddy (HTTPS) → nginx → API: HAI lớp proxy (#244). Bắt buộc ở SaaS, nếu không mọi công ty dùng chung một hạn mức đăng nhập.
      TRUST_PROXY_HOPS: '2',
      COOKIE_SECURE: 'true',
      COMPOSE_PROFILES: 'https',
      ...backupEnv,
    },
    // SaaS: không có tenantId — công ty nhận ra theo tên miền (docs/DECISIONS.md #237).
    configJson: { apiBaseUrl: '' },
    caddyfile: buildCaddyfile('saas', domain),
    publicUrl: origin,
    requiredPorts: [80, 443],
    summary: [
      ['Kiểu triển khai', PROFILE_LABEL.saas],
      ['Địa chỉ truy cập', origin],
      ['Người vận hành', `${answers.operatorFullName ?? ''} (${answers.operatorUsername ?? ''}), mật khẩu do bạn đặt`],
      ['Xác thực 2 lớp', 'Kích hoạt OTP ngay sau khi cài'],
      ['Chứng chỉ', `Wildcard *.${domain}`],
      ['Sao lưu', backupSummary],
    ],
  };
}

export type FieldErrors = Record<string, string>;

function collect<T>(errors: FieldErrors, key: string, result: Validation<T>): T | undefined {
  if (result.ok) return result.value;
  errors[key] = result.error;
  return undefined;
}

/** Kiểm tra toàn bộ câu trả lời (máy chủ gọi lại lần cuối trước khi cài, không tin giao diện). Trả về câu trả lời đã chuẩn hoá hoặc lỗi theo từng ô. */
export function validateAnswers(raw: Partial<InstallAnswers> & { operatorPasswordConfirm?: string }): { ok: true; value: InstallAnswers } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const profile = raw.profile;
  if (profile !== 'lan' && profile !== 'vps' && profile !== 'saas') return { ok: false, errors: { profile: 'Chọn kiểu triển khai.' } };

  const value: InstallAnswers = { profile, backupDir: '', backupHourVn: 2 };
  value.backupDir = collect(errors, 'backupDir', validateBackupDir(raw.backupDir ?? '')) ?? '';
  value.backupHourVn = collect(errors, 'backupHourVn', validateHour(raw.backupHourVn ?? 2)) ?? 2;
  const retention = Number(raw.backupRetentionDays ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isInteger(retention) || retention < 1 || retention > 365) errors.backupRetentionDays = 'Số ngày giữ bản sao là số từ 1 đến 365.';
  else value.backupRetentionDays = retention;

  if (profile === 'lan') {
    value.lanAddress = collect(errors, 'lanAddress', validateLanAddress(raw.lanAddress ?? ''));
    value.webPort = collect(errors, 'webPort', validatePort(raw.webPort ?? 80));
  } else {
    value.domain = collect(errors, 'domain', validateDomain(raw.domain ?? ''));
  }
  if (profile === 'vps') value.acmeEmail = collect(errors, 'acmeEmail', validateEmail(raw.acmeEmail ?? ''));

  if (profile === 'saas') {
    value.operatorFullName = collect(errors, 'operatorFullName', validateRequiredText(raw.operatorFullName ?? '', 'họ tên'));
    value.operatorUsername = collect(errors, 'operatorUsername', validateUsername(raw.operatorUsername ?? ''));
    const password = raw.operatorPassword ?? '';
    if (!assessPassword(password).acceptable) errors.operatorPassword = assessPassword(password).hint;
    else if (password !== raw.operatorPasswordConfirm) errors.operatorPasswordConfirm = 'Hai mật khẩu chưa khớp.';
    else value.operatorPassword = password;
  } else {
    value.clinicName = collect(errors, 'clinicName', validateRequiredText(raw.clinicName ?? '', 'tên phòng khám'));
    value.adminFullName = collect(errors, 'adminFullName', validateRequiredText(raw.adminFullName ?? '', 'họ tên quản trị viên'));
    value.adminUsername = collect(errors, 'adminUsername', validateUsername(raw.adminUsername ?? ''));
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}
