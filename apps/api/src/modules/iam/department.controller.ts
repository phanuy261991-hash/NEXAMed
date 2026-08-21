import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createDepartmentRequestSchema, updateDepartmentRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { DepartmentService } from './department.service';

/**
 * Khoa/Phòng (mở rộng ADM-01) — dùng chung permission `user_account.*` (không tạo permission
 * mới, department chỉ phục vụ trường "Khoa/Phòng" trên form tài khoản).
 */
@Controller('departments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Post()
  @RequirePermission('user_account', 'manage')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createDepartmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.departmentService.createDepartment(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('user_account', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.departmentService.listDepartments(tenantId);
  }

  /**
   * "Hàng đợi ảo" (#064) — chiếu tối thiểu cho khu vực Điều phối Bác sĩ/Khoa lúc Tiếp nhận
   * (`ReceptionIntakeForm.tsx`). Gắn quyền `reference_catalog.read` thay vì `user_account.read`
   * (đúng lý do đã áp dụng cho `GET /appointments/doctors`, `docs/DECISIONS.md` #030) — lễ tân/bác
   * sĩ/điều dưỡng có `reference_catalog.read` nhưng không có `user_account.read`.
   */
  @Get('options')
  @RequirePermission('reference_catalog', 'read')
  async listOptions(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.departmentService.listDepartmentOptions(tenantId);
  }

  @Patch(':id')
  @RequirePermission('user_account', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateDepartmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.departmentService.updateDepartment(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
