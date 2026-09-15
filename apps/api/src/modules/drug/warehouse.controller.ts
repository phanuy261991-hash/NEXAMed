import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createWarehouseRequestSchema, updateWarehouseRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WarehouseService } from './warehouse.service';

/** Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — dùng chung `drug.read`/`drug.manage`
 * (cùng trang "Danh mục Thuốc & Vật tư" ở web, route đã gate `drug.manage`). */
@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  @RequirePermission('drug', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.warehouseService.listWarehouses(tenantId);
  }

  @Post()
  @RequirePermission('drug', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createWarehouseRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.warehouseService.createWarehouse(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('drug', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateWarehouseRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.warehouseService.updateWarehouse(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
