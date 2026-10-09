import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  acceptShiftSwapRequestSchema,
  cancelShiftSwapRequestSchema,
  createShiftSwapRequestSchema,
  declineShiftSwapRequestSchema,
  listShiftSwapsQuerySchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ShiftSwapService } from './shift-swap.service';

/** Chấm số + đánh dấu đã xem chỉ của người xem TOÀN BỘ lịch sử (scope `global`, mặc định quản lý). */
function assertGlobalScope(req: Request): void {
  if (req.dataScope !== 'global') {
    throw new ForbiddenException('Chỉ áp dụng cho tài khoản xem toàn bộ lịch sử đổi ca.');
  }
}

/** "Đổi ca" (#225) — xem docstring `ShiftSwapService`. Route tĩnh khai TRƯỚC route `:id`. */
@Controller('shift-swaps')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ShiftSwapController {
  constructor(private readonly service: ShiftSwapService) {}

  @Get()
  @RequirePermission('shift_swap', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listShiftSwapsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, userId, req.dataScope!, dto);
  }

  /** Yêu cầu đang chờ MÌNH xác nhận. */
  @Get('incoming-count')
  @RequirePermission('shift_swap', 'create')
  async incomingCount(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.incomingCount(tenantId, userId);
  }

  @Get('unseen-count')
  @RequirePermission('shift_swap', 'read')
  async unseenCount(@Req() req: Request) {
    assertGlobalScope(req);
    return this.service.unseenCount(req.user!.tenantId);
  }

  @Post('mark-seen')
  @RequirePermission('shift_swap', 'read')
  @HttpCode(200)
  async markSeen(@Req() req: Request) {
    assertGlobalScope(req);
    const { userId, tenantId } = req.user!;
    return this.service.markSeen(tenantId, userId);
  }

  @Get('colleagues')
  @RequirePermission('shift_swap', 'create')
  async colleagues(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.colleagues(tenantId, userId);
  }

  @Get('colleagues/:userId/assignments')
  @RequirePermission('shift_swap', 'create')
  async colleagueAssignments(@Param('userId', ParseUUIDPipe) colleagueId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.colleagueAssignments(tenantId, userId, colleagueId);
  }

  @Get('assignments/:assignmentId/check')
  @RequirePermission('shift_swap', 'create')
  async checkOwnAssignment(@Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.checkOwnAssignment(tenantId, userId, assignmentId);
  }

  @Post()
  @RequirePermission('shift_swap', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createShiftSwapRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post(':id/accept')
  @RequirePermission('shift_swap', 'create')
  @HttpCode(200)
  async accept(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = acceptShiftSwapRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.accept(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/decline')
  @RequirePermission('shift_swap', 'create')
  @HttpCode(200)
  async decline(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = declineShiftSwapRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.decline(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('shift_swap', 'create')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelShiftSwapRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.service.cancel(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
