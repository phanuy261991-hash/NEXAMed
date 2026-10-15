import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UpdateCheckPort, UpdateCheckResult } from '@nexamed/core';
import { releaseManifestSchema, type UpdateChannel } from '@nexamed/shared';
import type { Env } from '../../config/env.schema';

const REQUEST_TIMEOUT_MS = 5_000;
/** File khai báo chỉ vài KB — chặn máy chủ phát hành (hoặc kẻ đứng giữa) trả về dữ liệu khổng lồ làm đầy bộ nhớ. */
const MAX_MANIFEST_BYTES = 256 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Adapter v1 cho `UpdateCheckPort` (docs/DECISIONS.md #236, bước 2): đọc `<RELEASE_SERVER_URL>/manifest.json` qua HTTPS và lấy bản mới nhất của kênh. Chỉ KIỂM TRA, không tải gì về.
 * Bắt buộc HTTPS (trừ localhost, phục vụ thử nghiệm) vì nội dung quyết định người dùng có được mời cập nhật hay không; không theo chuyển hướng; có hạn thời gian và hạn kích thước.
 * Mọi sự cố trả `{ kind: 'error' }` với thông báo tiếng Việt, không ném lỗi và không đưa chi tiết nội bộ (đường dẫn, mã lỗi hệ điều hành) ra ngoài.
 */
@Injectable()
export class HttpReleaseServerAdapter implements UpdateCheckPort {
  private readonly logger = new Logger(HttpReleaseServerAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isConfigured(): boolean {
    return this.getServerUrl() !== null;
  }

  getServerUrl(): string | null {
    // ConfigService trả giá trị THÔ của biến môi trường (chưa qua bước đổi chuỗi rỗng → undefined của schema); docker-compose luôn truyền biến này, rỗng khi chưa cấu hình.
    const value = this.config.get('RELEASE_SERVER_URL', { infer: true })?.trim();
    return value ? value : null;
  }

  async fetchLatest(channel: UpdateChannel): Promise<UpdateCheckResult> {
    const serverUrl = this.getServerUrl();
    if (!serverUrl) return { kind: 'error', message: 'Chưa cấu hình máy chủ phát hành.' };

    let manifestUrl: URL;
    try {
      manifestUrl = new URL('manifest.json', serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`);
    } catch {
      return { kind: 'error', message: 'Địa chỉ máy chủ phát hành không hợp lệ.' };
    }
    if (manifestUrl.protocol !== 'https:' && !(manifestUrl.protocol === 'http:' && LOCAL_HOSTS.has(manifestUrl.hostname))) {
      return { kind: 'error', message: 'Máy chủ phát hành phải dùng kết nối HTTPS.' };
    }

    try {
      const response = await fetch(manifestUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return { kind: 'error', message: `Máy chủ phát hành trả lời lỗi (${response.status}).` };

      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > MAX_MANIFEST_BYTES) return { kind: 'error', message: 'Dữ liệu từ máy chủ phát hành quá lớn.' };
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) return { kind: 'error', message: 'Dữ liệu từ máy chủ phát hành quá lớn.' };

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return { kind: 'error', message: 'Máy chủ phát hành trả về dữ liệu sai định dạng.' };
      }
      const parsed = releaseManifestSchema.safeParse(json);
      if (!parsed.success) return { kind: 'error', message: 'Máy chủ phát hành trả về dữ liệu sai định dạng.' };
      return { kind: 'ok', latest: parsed.data.channels[channel] ?? null };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      // Chỉ ghi loại lỗi — địa chỉ máy chủ và chi tiết hệ điều hành không đưa vào log hay phản hồi.
      this.logger.warn(`Kiểm tra bản mới thất bại (${error instanceof Error ? error.name : 'lỗi không xác định'}).`);
      return { kind: 'error', message: timedOut ? 'Máy chủ phát hành không trả lời kịp thời.' : 'Không kết nối được máy chủ phát hành.' };
    }
  }
}
