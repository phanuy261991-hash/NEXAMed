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

  @Patch()
  @RequirePermission('clinic_config', 'update')
  async update(@Body() body: unknown, @Req() req: Request) {
    const dto = updateClinicSettingsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.clinicSettingsService.updateSettings(tenantId, userId, dto, extractRequestMeta(req));
  }
}
