import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createAllergenGroupRequestSchema, updateAllergenGroupRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { AllergenGroupService } from './allergen-group.service';

/**
 * "Nhóm dị nguyên" (docs/DECISIONS.md #069) — danh mục dùng chung toàn hệ thống. Không gắn
 * `entityIdParam` cho `PermissionGuard` — break-glass không có ý nghĩa với dữ liệu toàn hệ thống
 * không có chủ sở hữu, đúng lý do `ReferenceCatalogController` đã ghi.
 */
@Controller('allergen-groups')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AllergenGroupController {
  constructor(private readonly allergenGroupService: AllergenGroupService) {}

  @Get()
  @RequirePermission('allergen_catalog', 'read')
  async list(@Query('includeInactive') includeInactive: string | undefined, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.allergenGroupService.list(tenantId, includeInactive === 'true');
  }

  @Post()
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createAllergenGroupRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.allergenGroupService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('allergen_catalog', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateAllergenGroupRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.allergenGroupService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /** "Xoá" = is_active=false (soft) — role DB `nexamed_app` không có quyền DELETE thật. */
  @Delete(':id')
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async deactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.allergenGroupService.setActive(tenantId, userId, id, false, extractRequestMeta(req));
  }

  @Post(':id/reactivate')
  @RequirePermission('allergen_catalog', 'manage')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.allergenGroupService.setActive(tenantId, userId, id, true, extractRequestMeta(req));
  }
}
