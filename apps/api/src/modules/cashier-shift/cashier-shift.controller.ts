import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveCashierShiftRequestSchema,
  closeCashierShiftRequestSchema,
  editCashierShiftRequestSchema,
  listCashierShiftsQuerySchema,
  openCashierShiftRequestSchema,
  resolveCashierShiftDiscrepancyRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { CashierShiftService } from './cashier-shift.service';

/**
 * "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03). Thứ tự khai báo route
 * quan trọng — `current`/list (`GET` không tham số) phải đứng TRƯỚC `:id` để Express không nuốt
 * nhầm "current" thành `:id` (cùng bài học `PatientController.checkDuplicate()` S2-03).
 */
@Controller('cashier-shifts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CashierShiftController {
  constructor(private readonly cashierShiftService: CashierShiftService) {}

  @Get('current')
  @RequirePermission('cashier_shift', 'read')
  async current(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.cashierShiftService.getCurrent(tenantId);
  }

  @Post('open')
  @RequirePermission('cashier_shift', 'create')
  @HttpCode(200)
  async open(@Body() body: unknown, @Req() req: Request) {
    const dto = openCashierShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashierShiftService.openShift(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Get()
  @RequirePermission('cashier_shift', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listCashierShiftsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.cashierShiftService.list(tenantId, req.dataScope!, dto);
  }

  @Get(':id/summary')
  @RequirePermission('cashier_shift', 'read', { entityIdParam: 'id' })
  async summary(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.cashierShiftService.getSummary(tenantId, id);
  }

  @Get(':id')
  @RequirePermission('cashier_shift', 'read', { entityIdParam: 'id' })
  async get(@Param('id') id: string, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.cashierShiftService.getDetail(tenantId, userId, req.dataScope!, id);
  }

  @Post(':id/close')
  @RequirePermission('cashier_shift', 'create', { entityIdParam: 'id' })
  @HttpCode(200)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = closeCashierShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashierShiftService.close(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Quản lý xem trước "Tính toán lại" (chưa lưu) — dùng lại đúng hàm tính của bước 1 wizard. */
  @Get(':id/resync-preview')
  @RequirePermission('cashier_shift', 'manage', { entityIdParam: 'id' })
  async resyncPreview(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.cashierShiftService.getSummary(tenantId, id);
  }

  @Post(':id/resolve-discrepancy')
  @RequirePermission('cashier_shift', 'manage', { entityIdParam: 'id' })
  @HttpCode(200)
  async resolveDiscrepancy(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = resolveCashierShiftDiscrepancyRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashierShiftService.resolveDiscrepancy(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('cashier_shift', 'manage', { entityIdParam: 'id' })
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveCashierShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashierShiftService.approve(tenantId, userId, id, dto.version, extractRequestMeta(req));
  }

  /** "Mở khoá để sửa" — sửa số liệu người nhập + "Tính toán lại" số hệ thống trong cùng lần submit. */
  @Post(':id/edit')
  @RequirePermission('cashier_shift', 'manage', { entityIdParam: 'id' })
  @HttpCode(200)
  async edit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = editCashierShiftRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.cashierShiftService.edit(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
