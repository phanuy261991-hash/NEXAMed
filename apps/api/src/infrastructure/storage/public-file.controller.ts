import { Controller, Get, HttpException, HttpStatus, Inject, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { STORAGE_PORT, type StoragePort } from '@nexamed/core';
import { verifyFileToken } from './signed-url';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
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

  @Get(':token')
  async getByToken(@Param('token') token: string, @Res() res: Response): Promise<void> {
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
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(Buffer.from(content));
  }
}
