import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { updateBackupConfigRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { BackupConfigService } from './backup-config.service';

/** "Cấu hình hệ thống → Sao lưu dữ liệu" (docs/DECISIONS.md #217): cấu hình + "Sao lưu ngay". Xem trạng thái lần gần nhất ở `GET /backup-status` có sẵn (S6-01). */
@Controller('backup-config')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BackupConfigController {
  constructor(private readonly service: BackupConfigService) {}

  @Get()
  @RequirePermission('system_backup', 'read')
  async get() {
    return this.service.get();
  }

  @Put()
  @RequirePermission('system_backup', 'manage')
  async update(@Body() body: unknown, @Req() req: Request) {
    const dto = updateBackupConfigRequestSchema.parse(body);
    return this.service.update(req.user!.tenantId, req.user!.userId, dto, extractRequestMeta(req));
  }

  @Post('run-now')
  @RequirePermission('system_backup', 'manage')
  @HttpCode(200)
  async runNow(@Req() req: Request) {
    return this.service.runNow(req.user!.tenantId, req.user!.userId, extractRequestMeta(req));
  }
}
