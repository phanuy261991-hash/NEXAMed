import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  createReferenceCatalogRequestSchema,
  referenceCatalogCategorySchema,
  updateReferenceCatalogRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ReferenceCatalogService } from './reference-catalog.service';

/**
 * Danh mục dùng chung toàn hệ thống (S3 ngoài kế hoạch, docs/DECISIONS.md — đảo ngược #034 phần
 * ethnicity/nationality). `reference_catalog.read` mở cho mọi vai trò lâm sàng (ai điền form
 * bệnh nhân cũng cần thấy dropdown); `reference_catalog.manage` chỉ `clinic_admin`. Không gắn
 * `entityIdParam` cho PATCH/DELETE — break-glass không có ý nghĩa với dữ liệu toàn hệ thống
 * không có chủ sở hữu, `none` bị chặn hẳn (đúng tinh thần security-audit.md).
 */
@Controller('reference-catalog')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReferenceCatalogController {
  constructor(private readonly referenceCatalogService: ReferenceCatalogService) {}

  @Get(':category')
  @RequirePermission('reference_catalog', 'read')
  async listByCategory(
    @Param('category') categoryParam: string,
    @Query('includeInactive') includeInactive: string | undefined,
    @Req() req: Request,
  ) {
    const category = referenceCatalogCategorySchema.parse(categoryParam);
    const { tenantId } = req.user!;
    return this.referenceCatalogService.listByCategory(tenantId, category, includeInactive === 'true');
  }

  @Post()
  @RequirePermission('reference_catalog', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createReferenceCatalogRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.referenceCatalogService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('reference_catalog', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateReferenceCatalogRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.referenceCatalogService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /** "Xoá" = is_active=false (soft) — role DB `nexamed_app` không có quyền DELETE (bị revoke toàn
   * cục ở migration *_tenant_context), không thể xoá cứng dù muốn. */
  @Delete(':id')
  @RequirePermission('reference_catalog', 'manage')
  @HttpCode(200)
  async deactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.referenceCatalogService.setActive(tenantId, userId, id, false, extractRequestMeta(req));
  }

  @Post(':id/reactivate')
  @RequirePermission('reference_catalog', 'manage')
  @HttpCode(200)
  async reactivate(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.referenceCatalogService.setActive(tenantId, userId, id, true, extractRequestMeta(req));
  }
}
