import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveScheduleSubmissionRequestSchema,
  listScheduleSubmissionsQuerySchema,
  returnScheduleSubmissionRequestSchema,
  submitScheduleSubmissionRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WorkScheduleSubmissionService } from './work-schedule-submission.service';

/** "Duyệt đăng ký ca theo tháng" (#225) — xem docstring `WorkScheduleSubmissionService`. */
@Controller('work-shift-assignments/submissions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WorkScheduleSubmissionController {
  constructor(private readonly service: WorkScheduleSubmissionService) {}

  @Get()
  @RequirePermission('work_shift_assignment', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listScheduleSubmissionsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, userId, req.dataScope!, dto);
  }

  @Get('pending-count')
  @RequirePermission('work_shift_assignment', 'approve')
  async pendingCount(@Req() req: Request) {
    return this.service.pendingCount(req.user!.tenantId);
  }

  @Post('submit')
  @RequirePermission('work_shift_assignment', 'create')
  @HttpCode(200)
  async submit(@Body() body: unknown, @Req() req: Request) {
    const dto = submitScheduleSubmissionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.submit(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('work_shift_assignment', 'approve')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveScheduleSubmissionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.approve(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/return')
  @RequirePermission('work_shift_assignment', 'approve')
  @HttpCode(200)
  async returnBack(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = returnScheduleSubmissionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.returnBack(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
