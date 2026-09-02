import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createWorkShiftRequestSchema, updateWorkShiftRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WorkShiftService } from './work-shift.service';

/**
 * "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca RIÊNG theo phòng khám (tenant-scoped).
 * `create`/`update` (thêm/sửa mẫu ca) vẫn dùng `clinic_config.update`, chỉ `clinic_admin` quản lý.
 * `list` (đọc) dùng `work_shift.read` riêng (không phải `clinic_config.read`) — MỌI nhân viên tự
 * đăng ký ca (Giai đoạn 2 #101) cần đọc được danh mục này để chọn, mà `clinic_config.read` mặc
 * định chỉ `clinic_admin` có; dùng chung sẽ chặn 4/5 vai trò khỏi chính tính năng dành cho họ —
 * bug thật phát hiện lúc kiểm bằng tài khoản không phải `clinic_admin` (trước giờ chỉ verify bằng
 * `clinic_admin` nên chưa lộ, cùng dạng lỗ hổng RBAC tự-phục vụ đã gặp ở #030/#064).
 */
@Controller('work-shifts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WorkShiftController {
  constructor(private readonly workShiftService: WorkShiftService) {}

  @Post()
  @RequirePermission('clinic_config', 'update')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createWorkShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.workShiftService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('work_shift', 'read')
  async list(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.workShiftService.list(tenantId);
  }

  @Patch(':id')
  @RequirePermission('clinic_config', 'update', { entityIdParam: 'id' })
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateWorkShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.workShiftService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
