import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createDepartmentTypeRequestSchema, updateDepartmentTypeRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DepartmentTypeService } from './department-type.service';

/** "Loại Khoa/Phòng" (mở rộng ADM-01) — dùng chung quyền `user_account.*` với `DepartmentController`. */
@Controller('department-types')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentTypeController {
  constructor(private readonly departmentTypeService: DepartmentTypeService) {}

  @Post()
  @RequirePermission('user_account', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createDepartmentTypeRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.departmentTypeService.createDepartmentType(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('user_account', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.departmentTypeService.listDepartmentTypes(tenantId);
  }

  @Patch(':id')
  @RequirePermission('user_account', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateDepartmentTypeRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.departmentTypeService.updateDepartmentType(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}