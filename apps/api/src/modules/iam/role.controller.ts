import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  createRoleRequestSchema,
  hideRoleRequestSchema,
  renameRoleRequestSchema,
  updateRolePermissionsRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { RoleService } from './role.service';

/**
 * Vai trò tuỳ biến + ma trận phân quyền (ADM-07). Dùng chung permission `role_permission.manage`
 * cho mọi endpoint (đọc lẫn ghi) — danh mục `permission` chỉ có đúng quyền này cho cả domain
 * "vai trò/phân quyền" (không có `role_permission.read` riêng), và chỉ `clinic_admin` cần vào
 * màn hình này (.claude/docs/security-audit.md). Không gắn `entityIdParam` — break-glass không
 * có ý nghĩa với cấu hình phân quyền (không phải dữ liệu lâm sàng có chủ sở hữu), `none` bị chặn
 * hẳn, cùng tinh thần `ReferenceCatalogController`.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get('roles')
  @RequirePermission('role_permission', 'manage')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return { items: await this.roleService.listRoles(tenantId) };
  }

  @Post('roles')
  @RequirePermission('role_permission', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createRoleRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.roleService.createRole(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch('roles/:id')
  @RequirePermission('role_permission', 'manage')
  async rename(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = renameRoleRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.roleService.renameRole(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /** POST thay vì DELETE — cần gửi kèm `version` (optimistic locking), cùng khuôn `appointment.cancel`. */
  @Post('roles/:id/hide')
  @RequirePermission('role_permission', 'manage')
  @HttpCode(200)
  async hide(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = hideRoleRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    await this.roleService.hideRole(tenantId, userId, id, dto, extractRequestMeta(req));
    return { success: true };
  }

  @Get('roles/:id/permissions')
  @RequirePermission('role_permission', 'manage')
  async getMatrix(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.roleService.getRoleMatrix(tenantId, id);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('role_permission', 'manage')
  async updateMatrix(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateRolePermissionsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.roleService.updateRoleMatrix(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}