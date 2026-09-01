import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createWorkShiftRequestSchema, updateWorkShiftRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WorkShiftService } from './work-shift.service';

/**
 * "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca RIÊNG theo phòng khám (tenant-scoped),
 * dùng chung permission `clinic_config.*` với `RoomController` (cùng lý do — ADM-02 gộp cấu hình
 * phòng khám làm một, không tách quyền riêng theo từng loại danh mục con).
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
  @RequirePermission('clinic_config', 'read')
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
