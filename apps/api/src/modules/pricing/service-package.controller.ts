import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createServicePackageRequestSchema, listServicePackagesQuerySchema, updateServicePackageRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ServicePackageService } from './service-package.service';

/**
 * Gói dịch vụ (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). `service_package.read` mở cho mọi vai trò lâm sàng/lễ tân;
 * thêm/sửa chỉ clinic_admin. "Ngừng gói" = `isActive=false` qua PATCH.
 */
@Controller('service-packages')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServicePackageController {
  constructor(private readonly service: ServicePackageService) {}

  @Get()
  @RequirePermission('service_package', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    return this.service.list(req.user!.tenantId, listServicePackagesQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermission('service_package', 'read')
  async getById(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.getById(req.user!.tenantId, id);
  }

  @Post()
  @RequirePermission('service_package', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createServicePackageRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('service_package', 'update')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateServicePackageRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
