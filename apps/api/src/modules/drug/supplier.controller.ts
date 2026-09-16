import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createSupplierRequestSchema, updateSupplierRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { SupplierService } from './supplier.service';

/** Nhà cung cấp (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — dùng chung `drug.read`/
 * `drug.create`/`drug.update` (tách từ `drug.manage` gộp cũ, #156; cùng trang "Danh mục Thuốc &
 * Vật tư" ở web). */
@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @RequirePermission('drug', 'read')
  async list(@Query('includeInactive') includeInactive: string | undefined, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.supplierService.list(tenantId, includeInactive === 'true');
  }

  @Post()
  @RequirePermission('drug', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createSupplierRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.supplierService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('drug', 'update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateSupplierRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.supplierService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
