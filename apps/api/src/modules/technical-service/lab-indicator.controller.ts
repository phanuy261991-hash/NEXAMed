import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createLabIndicatorRequestSchema, listLabIndicatorsQuerySchema, updateLabIndicatorRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LabIndicatorService } from './lab-indicator.service';

/** Chỉ số xét nghiệm + khoảng tham chiếu (docs/DECISIONS.md #212) — cùng module quyền `technical_service` với danh mục dịch vụ. */
@Controller('lab-indicators')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabIndicatorController {
  constructor(private readonly service: LabIndicatorService) {}

  @Get()
  @RequirePermission('technical_service', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listLabIndicatorsQuerySchema.parse(query);
    return this.service.list(req.user!.tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('technical_service', 'read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.getById(req.user!.tenantId, id);
  }

  @Post()
  @RequirePermission('technical_service', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createLabIndicatorRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('technical_service', 'update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateLabIndicatorRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
