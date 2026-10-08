import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createTechnicalServiceRequestSchema, listTechnicalServicesQuerySchema, updateTechnicalServiceRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { TechnicalServiceService } from './technical-service.service';

/**
 * Danh mục dịch vụ kỹ thuật cận lâm sàng (docs/DECISIONS.md #212). `technical_service.read` mở cho mọi vai trò lâm
 * sàng; thêm/sửa chỉ clinic_admin. "Xoá" = `isActive=false` qua PATCH, cùng khuôn `drug`.
 */
@Controller('technical-services')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class TechnicalServiceController {
  constructor(private readonly service: TechnicalServiceService) {}

  @Get()
  @RequirePermission('technical_service', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listTechnicalServicesQuerySchema.parse(query);
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
    const dto = createTechnicalServiceRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('technical_service', 'update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateTechnicalServiceRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
