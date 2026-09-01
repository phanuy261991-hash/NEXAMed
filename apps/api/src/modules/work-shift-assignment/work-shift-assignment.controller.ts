import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  bulkCreateWorkShiftAssignmentRequestSchema,
  copyWorkShiftAssignmentsRequestSchema,
  createWorkShiftAssignmentRequestSchema,
  deleteWorkShiftAssignmentRequestSchema,
  listWorkShiftAssignmentsQuerySchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WorkShiftAssignmentService } from './work-shift-assignment.service';

/** "Đăng ký ca làm việc" — xem docstring `WorkShiftAssignmentService`. */
@Controller('work-shift-assignments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WorkShiftAssignmentController {
  constructor(private readonly service: WorkShiftAssignmentService) {}

  @Get()
  @RequirePermission('work_shift_assignment', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listWorkShiftAssignmentsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, userId, req.dataScope!, dto);
  }

  @Post()
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Áp dụng cho các ngày đã chọn" (bulk-apply nhiều ngày cùng 1 ca) — khai TRƯỚC route gốc không
   * cần thiết (khác `@Post()` không tham số, không xung đột thứ tự route). */
  @Post('bulk')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async bulkCreate(@Body() body: unknown, @Req() req: Request) {
    const dto = bulkCreateWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.bulkCreate(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Sao chép tuần/tháng trước". */
  @Post('copy')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async copy(@Body() body: unknown, @Req() req: Request) {
    const dto = copyWorkShiftAssignmentsRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.copy(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Delete(':id')
  @RequirePermission('work_shift_assignment', 'delete', { entityIdParam: 'id' })
  async remove(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = deleteWorkShiftAssignmentRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    await this.service.remove(tenantId, userId, req.dataScope!, id, dto.version, extractRequestMeta(req));
    return { success: true };
  }
}
