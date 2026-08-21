import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createAllergenRequestSchema, updateAllergenRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { AllergenService } from './allergen.service';

/** "Dị nguyên" (docs/DECISIONS.md #069) — danh mục dùng chung toàn hệ thống, luôn thuộc 1 Nhóm dị nguyên. */
@Controller('allergens')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AllergenController {
  constructor(private readonly allergenService: AllergenService) {}

  @Get()
  @RequirePermission('allergen_catalog', 'read')
  async list(@Query('includeInactive') includeInactive: string | undefined, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.allergenService.list(tenantId, includeInactive === 'true');
  }

  @Post()
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createAllergenRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.allergenService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('allergen_catalog', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateAllergenRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.allergenService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /** "Xoá" = is_active=false (soft) — role DB `nexamed_app` không có quyền DELETE thật. */
  @Delete(':id')
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async deactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.allergenService.setActive(tenantId, userId, id, false, extractRequestMeta(req));
  }

  @Post(':id/reactivate')
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.allergenService.setActive(tenantId, userId, id, true, extractRequestMeta(req));
  }
}
