import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createAdviceTemplateRequestSchema, listAdviceTemplatesQuerySchema, updateAdviceTemplateRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { AdviceTemplateService } from './advice-template.service';

/**
 * "Mẫu lời dặn" (docs/DECISIONS.md #222) — `advice_template.read` cho bác sĩ/điều dưỡng/clinic_admin (chọn mẫu lúc soạn lời dặn), `advice_template.manage` chỉ bác sĩ/clinic_admin
 * (xem `packages/core/src/rbac/permissions.ts`). "Ẩn" = `isActive=false` qua PATCH, cùng khuôn `prescription_template`.
 */
@Controller('advice-templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AdviceTemplateController {
  constructor(private readonly service: AdviceTemplateService) {}

  @Get()
  @RequirePermission('advice_template', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listAdviceTemplatesQuerySchema.parse(query);
    return this.service.list(req.user!.tenantId, dto.includeInactive);
  }

  @Post()
  @RequirePermission('advice_template', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createAdviceTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('advice_template', 'manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateAdviceTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
