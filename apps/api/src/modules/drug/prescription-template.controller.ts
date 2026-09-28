import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createPrescriptionTemplateRequestSchema, updatePrescriptionTemplateRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { PrescriptionTemplateService } from './prescription-template.service';

/**
 * "Đơn thuốc mẫu" (Kho Thuốc GĐ5) — `prescription_template.read` mở cho mọi vai trò lâm sàng (chọn
 * mẫu lúc kê đơn), `prescription_template.manage` chỉ bác sĩ/clinic_admin (xem
 * `packages/core/src/rbac/permissions.ts`). "Xoá" = `isActive=false` qua PATCH, cùng khuôn `drug`.
 */
@Controller('prescription-templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PrescriptionTemplateController {
  constructor(private readonly templateService: PrescriptionTemplateService) {}

  @Get()
  @RequirePermission('prescription_template', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.templateService.list(tenantId);
  }

  @Post()
  @RequirePermission('prescription_template', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPrescriptionTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.templateService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('prescription_template', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePrescriptionTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.templateService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
