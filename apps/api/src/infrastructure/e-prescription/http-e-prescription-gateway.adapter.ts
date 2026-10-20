import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseGatewayErrors,
  parseGatewaySuccessMessage,
  type EPrescriptionGatewayEndpoint,
  type EPrescriptionGatewayPort,
  type EPrescriptionGatewayResult,
} from '@nexamed/core';
import type { Env } from '../../config/env.schema';

const MAX_RESPONSE_BYTES = 1_000_000;

/** IPv4 riêng/loopback/link-local (kể cả dải metadata đám mây 169.254.x.x) và các tên máy nội bộ phổ biến. */
function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // IPv6 dạng chữ: loopback, unique-local (fc00::/7), link-local (fe80::/10), IPv4-mapped.
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/**
 * Adapter HTTP thật của cổng Đơn thuốc quốc gia (Quyết định 808/QĐ-BYT, docs/DECISIONS.md #242 GĐ3). Viết THEO TÀI LIỆU; CHƯA kiểm với cổng thật (chưa có môi trường thử, xem
 * `docs/product/prescription-interop-questions.md`) — chỉ kiểm bằng máy chủ giả trong test.
 *
 * An toàn: địa chỉ cổng do quản trị phòng khám đặt nên ở chế độ SaaS (nhiều công ty chung máy chủ) TỪ CHỐI địa chỉ không phải https hoặc trỏ tới máy nội bộ/IP riêng (chống SSRF);
 * chế độ một công ty cho phép máy cục bộ để thử. Chưa chống DNS rebinding (tên miền công khai trỏ về IP riêng) — ghi nhận, xử lý khi triển khai SaaS thật. KHÔNG ghi nhật ký nội dung
 * yêu cầu/phản hồi (có mật khẩu, token, dữ liệu bệnh nhân) — chỉ ghi đường dẫn, mã trạng thái, thời gian. Không bao giờ ném lỗi ra ngoài.
 */
@Injectable()
export class HttpEPrescriptionGatewayAdapter implements EPrescriptionGatewayPort {
  private readonly logger = new Logger(HttpEPrescriptionGatewayAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  loginFacility(endpoint: EPrescriptionGatewayEndpoint, credential: { facilityCode: string; password: string }) {
    return this.postForToken(endpoint, '/api/auth/dang-nhap-co-so-kham-chua-benh', { ma_lien_thong_co_so_kham_chua_benh: credential.facilityCode, password: credential.password });
  }

  addDoctorToFacility(endpoint: EPrescriptionGatewayEndpoint, facilityToken: string, doctorCode: string) {
    return this.postForMessage(endpoint, '/api/v1/them-bac-si', { ma_lien_thong_bac_si: doctorCode }, facilityToken);
  }

  removeDoctorFromFacility(endpoint: EPrescriptionGatewayEndpoint, facilityToken: string, doctorCode: string) {
    return this.postForMessage(endpoint, '/api/v1/xoa-bac-si', { ma_lien_thong_bac_si: doctorCode }, facilityToken);
  }

  loginDoctor(endpoint: EPrescriptionGatewayEndpoint, credential: { doctorCode: string; facilityCode: string; password: string }) {
    return this.postForToken(endpoint, '/api/auth/dang-nhap-bac-si', {
      ma_lien_thong_bac_si: credential.doctorCode,
      ma_lien_thong_co_so_kham_chua_benh: credential.facilityCode,
      password: credential.password,
    });
  }

  private async postForToken(endpoint: EPrescriptionGatewayEndpoint, path: string, body: Record<string, unknown>): Promise<EPrescriptionGatewayResult<{ token: string }>> {
    const result = await this.post(endpoint, path, body);
    if (result.kind !== 'ok') return result;
    const token = result.body && typeof result.body === 'object' ? (result.body as Record<string, unknown>).token : undefined;
    if (typeof token !== 'string' || token.trim() === '') return { kind: 'unreachable', message: 'cổng trả phản hồi thành công nhưng không có token' };
    return { kind: 'ok', data: { token } };
  }

  private async postForMessage(endpoint: EPrescriptionGatewayEndpoint, path: string, body: Record<string, unknown>, token: string): Promise<EPrescriptionGatewayResult<{ message: string }>> {
    const result = await this.post(endpoint, path, body, token);
    if (result.kind !== 'ok') return result;
    return { kind: 'ok', data: { message: parseGatewaySuccessMessage(result.body) } };
  }

  /** Một lần POST JSON; trả `ok` kèm body đã parse hoặc một nhánh lỗi chuẩn hoá. */
  private async post(
    endpoint: EPrescriptionGatewayEndpoint,
    path: string,
    body: Record<string, unknown>,
    bearerToken?: string,
  ): Promise<{ kind: 'ok'; body: unknown } | Exclude<EPrescriptionGatewayResult<never>, { kind: 'ok' }>> {
    const blocked = this.checkEndpoint(endpoint.baseUrl);
    if (blocked) return { kind: 'unreachable', message: blocked };

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, endpoint.timeoutMs));
    try {
      const response = await fetch(`${endpoint.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(bearerToken ? { Authorization: `bearer ${bearerToken}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      const text = await this.readLimited(response);
      let parsed: unknown;
      try {
        parsed = text === '' ? undefined : JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      this.logger.log(`Cổng đơn thuốc ${path} → ${response.status} (${Date.now() - startedAt} ms)`);
      if (response.ok) return { kind: 'ok', body: parsed };
      if (response.status === 401) return { kind: 'unauthorized', errors: parseGatewayErrors(parsed) };
      if (response.status === 429 || response.status >= 500) return { kind: 'unreachable', message: `cổng quá tải hoặc lỗi (mã ${response.status})` };
      return { kind: 'rejected', status: response.status, errors: parseGatewayErrors(parsed) };
    } catch (err) {
      const timedOut = controller.signal.aborted;
      this.logger.warn(`Cổng đơn thuốc ${path} lỗi kết nối (${timedOut ? 'hết thời gian chờ' : err instanceof Error ? err.name : 'không rõ'}, ${Date.now() - startedAt} ms)`);
      return { kind: 'unreachable', message: timedOut ? `hết thời gian chờ ${Math.round(endpoint.timeoutMs / 1000)} giây` : 'lỗi kết nối mạng' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Đọc thân phản hồi nhưng không quá giới hạn (chống phản hồi khổng lồ). */
  private async readLimited(response: Response): Promise<string> {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) return '';
    return new TextDecoder().decode(buffer);
  }

  /** `null` nếu được phép gọi; ngược lại là lý do (tiếng Việt). Chế độ SaaS chặn http và máy nội bộ. */
  private checkEndpoint(baseUrl: string): string | null {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return 'địa chỉ máy chủ không hợp lệ';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'địa chỉ máy chủ không hợp lệ';
    if (this.config.get('DEPLOYMENT_MODE', { infer: true }) === 'saas' && (url.protocol !== 'https:' || isInternalHost(url.hostname))) {
      return 'địa chỉ không được phép ở chế độ dùng chung, chỉ https tới máy chủ công khai';
    }
    return null;
  }
}
