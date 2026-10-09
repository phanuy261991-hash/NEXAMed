import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveLeaveRequestRequestSchema,
  cancelLeaveRequestRequestSchema,
  createLeaveRequestOnBehalfRequestSchema,
  createLeaveRequestRequestSchema,
  leaveRequestMyImpactQuerySchema,
  listLeaveRequestsQuerySchema,
  rejectLeaveRequestRequestSchema,
  withdrawLeaveRequestRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { LeaveRequestService } from './leave-request.service';

/** "Đơn xin nghỉ" (#224) — xem docstring `LeaveRequestService`. Route tĩnh khai TRƯỚC route `:id`. */
@Controller('leave-requests')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LeaveRequestController {
  constructor(private readonly service: LeaveRequestService) {}

  @Get()
  @RequirePermission('leave_request', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listLeaveRequestsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, userId, req.dataScope!, dto);
  }

  /** Chấm số đơn chờ duyệt (Sidebar, tab "Đơn xin nghỉ"). */
  @Get('pending-count')
  @RequirePermission('leave_request', 'approve')
  async pendingCount(@Req() req: Request) {
    return this.service.pendingCount(req.user!.tenantId);
  }

  /** Dải cảnh báo ở hộp "Xin nghỉ": bao nhiêu lịch hẹn của chính mình nằm trong khung sắp nghỉ. */
  @Get('my-impact')
  @RequirePermission('leave_request', 'create')
  async myImpact(@Query() query: unknown, @Req() req: Request) {
    const dto = leaveRequestMyImpactQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.myImpact(tenantId, userId, dto);
  }

  @Post()
  @RequirePermission('leave_request', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createLeaveRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post('on-behalf')
  @RequirePermission('leave_request', 'file_on_behalf')
  @HttpCode(200)
  async createOnBehalf(@Body() body: unknown, @Req() req: Request) {
    const dto = createLeaveRequestOnBehalfRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.createOnBehalf(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get(':id/affected-appointments')
  @RequirePermission('leave_request', 'approve')
  async affectedAppointments(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.listAffectedAppointments(req.user!.tenantId, id);
  }

  @Post(':id/approve')
  @RequirePermission('leave_request', 'approve')
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveLeaveRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.approve(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('leave_request', 'approve')
  @HttpCode(200)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectLeaveRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.reject(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  /** Người gửi tự rút đơn chưa duyệt — quyền `create` (cùng quyền xin nghỉ). */
  @Post(':id/withdraw')
  @RequirePermission('leave_request', 'create')
  @HttpCode(200)
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = withdrawLeaveRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.withdraw(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('leave_request', 'approve')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelLeaveRequestRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.cancel(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
