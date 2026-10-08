import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createResultTemplateRequestSchema, listResultTemplatesQuerySchema, updateResultTemplateRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ResultTemplateService } from './result-template.service';

/**
 * "Mẫu kết quả" cận lâm sàng (docs/DECISIONS.md #212) — `result_template.read` mọi vai trò lâm sàng (chèn mẫu lúc
 * nhập kết quả), `manage` bác sĩ/clinic_admin. "Xoá" = `isActive=false` qua PATCH.
 */
@Controller('result-templates')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ResultTemplateController {
  constructor(private readonly service: ResultTemplateService) {}

  @Get()
  @RequirePermission('result_template', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listResultTemplatesQuerySchema.parse(query);
    return this.service.list(req.user!.tenantId, dto);
  }

  @Post()
  @RequirePermission('result_template', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createResultTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('result_template', 'manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateResultTemplateRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
