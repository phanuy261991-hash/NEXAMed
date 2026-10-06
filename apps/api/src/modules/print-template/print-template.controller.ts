import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  createPrintTemplateRequestSchema,
  deletePrintTemplateRequestSchema,
  printQuickSetupRequestSchema,
  updatePrintTemplateRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PrintTemplateService } from './print-template.service';

/**
 * "Quản lý mẫu in" (docs/DECISIONS.md #211) — quản lý dùng lại quyền `clinic_config.read/update` (cùng "Cấu hình
 * mẫu mã phát sinh"), không permission mới. `GET resolved` là chiếu TỰ-PHỤC VỤ (mọi nhân viên cần để in): KHÔNG gắn
 * `@RequirePermission`, có trong `LOGIN_ONLY_ROUTES` của test quét phân quyền.
 */
@Controller('print-templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PrintTemplateController {
  constructor(private readonly service: PrintTemplateService) {}

  @Get()
  @RequirePermission('clinic_config', 'read')
  async list(@Req() req: Request) {
    return this.service.list(req.user!.tenantId);
  }

  @Get('resolved')
  async listResolved(@Req() req: Request) {
    return this.service.listResolved(req.user!.tenantId);
  }

  @Post()
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPrintTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post('quick-setup')
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async quickSetup(@Body() body: unknown, @Req() req: Request) {
    const dto = printQuickSetupRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.quickSetup(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('clinic_config', 'update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePrintTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Delete(':id')
  @RequirePermission('clinic_config', 'update')
  async remove(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = deletePrintTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.remove(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
