import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { SingleTenantOnlyGuard } from '../../common/single-tenant-only.guard';
import { SoftwareUpdateService } from './software-update.service';

/**
 * "Cấu hình hệ thống → Cập nhật phần mềm" (docs/DECISIONS.md #236, bước 2): xem trạng thái và kiểm tra bản mới. CHỈ có ở hệ thống một công ty — ở chế độ SaaS trả 404.
 * `SingleTenantOnlyGuard` đặt trước `JwtAuthGuard` để người chưa đăng nhập cũng chỉ thấy 404.
 */
@Controller('system/update')
@UseGuards(SingleTenantOnlyGuard, JwtAuthGuard, PermissionGuard)
export class SoftwareUpdateController {
  constructor(private readonly service: SoftwareUpdateService) {}

  @Get('status')
  @RequirePermission('software_update', 'read')
  async status(@Req() req: Request) {
    return this.service.getStatus(req.user!.tenantId);
  }

  /** Ghi chú phát hành đóng kèm phần mềm (bản đang chạy + các bản trước) — luôn có, không cần máy chủ phát hành. */
  @Get('release-notes')
  @RequirePermission('software_update', 'read')
  releaseNotes() {
    return this.service.getReleaseNotesHistory();
  }

  @Post('check')
  @RequirePermission('software_update', 'read')
  @HttpCode(200)
  async check(@Req() req: Request) {
    return this.service.check(req.user!.tenantId, req.user!.userId, extractRequestMeta(req));
  }
}
