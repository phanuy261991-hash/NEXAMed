import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { updateClinicSettingsRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ClinicSettingsService } from './clinic-settings.service';

@Controller('clinic-settings')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClinicSettingsController {
  constructor(private readonly clinicSettingsService: ClinicSettingsService) {}

  @Get()
  @RequirePermission('clinic_config', 'read')
  async get(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.clinicSettingsService.getSettings(tenantId);
  }

  /**
   * Thu ngân cơ bản (Sprint 5/6) — tự-phục vụ, KHÔNG gắn `@RequirePermission` (đúng khuôn
   * `GET /appointments/doctors`, docs/DECISIONS.md #030): mọi user đã đăng nhập đọc được, không lộ
   * `businessHours`. Đặt TRƯỚC `@Get()` không cần thiết vì khác path cố định, không phải `:id`.
   */
  @Get('deferred-payment-enabled')
  async getDeferredPaymentEnabled(@Req() req: Request) {
    const { tenantId } = req.user!;
    const enabled = await this.clinicSettingsService.getDeferredPaymentEnabled(tenantId);
    return { enabled };
  }

  /**
   * "Cấu hình chung" — tự-phục vụ, KHÔNG gắn `@RequirePermission` (đúng khuôn
   * `getDeferredPaymentEnabled` ở trên): MỌI nhân viên (không chỉ `clinic_admin`) cần biết công tắc
   * này để "Lịch làm việc của tôi" ẩn/hiện đúng thao tác tự đăng ký.
   */
  @Get('allow-staff-self-schedule-enabled')
  async getAllowStaffSelfScheduleEnabled(@Req() req: Request) {
    const { tenantId } = req.user!;
    const enabled = await this.clinicSettingsService.getAllowStaffSelfScheduleEnabled(tenantId);
    return { enabled };
  }

  @Patch()
  @RequirePermission('clinic_config', 'update')
  async update(@Body() body: unknown, @Req() req: Request) {
    const dto = updateClinicSettingsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.clinicSettingsService.updateSettings(tenantId, userId, dto, extractRequestMeta(req));
  }
}
