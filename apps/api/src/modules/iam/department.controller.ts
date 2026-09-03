import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createDepartmentRequestSchema, listDepartmentOptionsQuerySchema, updateDepartmentRequestSchema } from '@nexamed/shared';
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
   * Chiếu tối thiểu tự-phục vụ (id/name), dùng bởi mọi vai trò không có `user_account.read`. Gắn
   * quyền `reference_catalog.read` (đúng lý do đã áp dụng cho `GET /appointments/doctors`,
   * `docs/DECISIONS.md` #030). MẶC ĐỊNH trả toàn bộ Khoa/Phòng active — dùng ở nhiều nơi ngoài
   * điều phối Tiếp nhận (ví dụ `MyAccountDialog.tsx` tự xem hồ sơ). `?queueOnly=true` (#107) —
   * CHỈ dùng ở khu vực điều phối "Hàng đợi khám" (`ReceptionIntakeForm.tsx` và tương tự) — lọc
   * thêm `participatesInQueue=true`, loại bộ phận hành chính (ví dụ "Bộ phận Lễ Tân").
   */
  @Get('options')
  @RequirePermission('reference_catalog', 'read')
  async listOptions(@Query() query: unknown, @Req() req: Request) {
    const { queueOnly } = listDepartmentOptionsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.departmentService.listDepartmentOptions(tenantId, queueOnly);
  }

  @Patch(':id')
  @RequirePermission('user_account', 'manage')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateDepartmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.departmentService.updateDepartment(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
