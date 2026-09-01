import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

/**
 * `GET /health` — kiểm tra sức khoẻ dịch vụ cho `docker-compose` healthcheck (S4-05,
 * `docs/product/plan.md` mục 7) và cho lệnh cài đặt tự dò API đã sẵn sàng chưa. Cố ý KHÔNG nằm
 * dưới prefix `api/v1` (loại trừ ở `main.ts`) — công cụ hạ tầng gọi `curl http://host:3000/health`
 * không cần biết version API. Không qua `PermissionGuard`/`JwtAuthGuard` (không yêu cầu đăng nhập,
 * đúng bản chất một health check hạ tầng), không trả thông tin nghiệp vụ/PII nào.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res() res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.status(HttpStatus.OK).json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'error', db: 'unreachable' });
    }
  }
}