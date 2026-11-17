import { Controller, Get, HttpException, HttpStatus, Inject, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { STORAGE_PORT, type StoragePort } from '@nexamed/core';
import { verifyFileToken } from './signed-url';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  // Kết quả xét nghiệm đối tác nhận về dạng PDF (docs/DECISIONS.md #291).
  pdf: 'application/pdf',
  // Hình ảnh & Tài liệu của bệnh nhân (#299): tệp DICOM chỉ lưu và tải về.
  dcm: 'application/dicom',
};

/**
 * Phục vụ file qua signed URL có hạn (.claude/docs/security-audit.md mục "File upload") — KHÔNG
 * gắn `JwtAuthGuard`: bản thân chữ ký trong token là lớp xác thực (tenantId/key đã "chốt cứng"
 * lúc ký, client không tự đổi được, hết hạn thì token vô dụng). `TenantContextMiddleware` vẫn
 * chạy trước route này (áp `forRoutes('*')`) nhưng không set được context vì không có JWT — vô
 * hại vì route này không đụng Prisma/RLS, chỉ đọc thẳng StoragePort bằng tenantId giải mã từ
 * token, không dựa vào tenant context của request.
 */
@Controller('files')
export class PublicFileController {
  constructor(
    private readonly configService: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * `:filename` (tuỳ chọn) CHỈ để trình xem của trình duyệt hiện đúng tên tệp (trình xem PDF lấy tên từ đoạn cuối đường dẫn, nếu không sẽ hiện chuỗi chữ ký khó đọc). Không thuộc chữ ký, không quyết định
   * tệp nào được trả — tệp luôn là tệp trong token; tên chỉ đi vào `Content-Disposition` sau khi lọc ký tự điều khiển và cắt độ dài.
   */
  @Get([':token', ':token/:filename'])
  async getByToken(@Param('token') token: string, @Param('filename') filename: string | undefined, @Res() res: Response): Promise<void> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    const payload = verifyFileToken(token, encryptionKey);
    if (!payload) {
      throw new HttpException('Đường dẫn không hợp lệ hoặc đã hết hạn.', HttpStatus.FORBIDDEN);
    }

    const extension = payload.key.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';

    let content: Uint8Array;
    try {
      content = await this.storage.read(payload.tenantId, payload.key);
    } catch {
      throw new HttpException('Không tìm thấy file.', HttpStatus.NOT_FOUND);
    }

    res.setHeader('Content-Type', contentType);
    const displayName = (filename ?? '').split('').filter((ch) => ch.charCodeAt(0) >= 32 && !'\\/"'.includes(ch)).join('').trim().slice(0, 200);
    if (displayName) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(content));
  }
}
