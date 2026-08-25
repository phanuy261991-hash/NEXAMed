import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createDrugRequestSchema, listDrugsQuerySchema, updateDrugRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DrugService } from './drug.service';

/**
 * Danh mục thuốc (Sprint 4, S4-03) — `drug.read` mở cho mọi vai trò lâm sàng (bác sĩ tìm thuốc lúc
 * kê đơn qua chính endpoint list này, không endpoint riêng — cùng khuôn `reference_catalog`),
 * `drug.manage` chỉ `clinic_admin`. "Xoá" = `isActive=false` qua PATCH (không endpoint riêng, khác
 * `reference_catalog` — cùng khuôn `room` vì `drug` có `version`/optimistic lock).
 */
@Controller('drugs')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DrugController {
  constructor(private readonly drugService: DrugService) {}

  @Get()
  @RequirePermission('drug', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listDrugsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.drugService.list(tenantId, dto);
  }

  @Post()
  @RequirePermission('drug', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createDrugRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.drugService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('drug', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateDrugRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.drugService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
