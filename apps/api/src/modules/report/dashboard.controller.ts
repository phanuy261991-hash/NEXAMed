import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ownerDashboardQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { DashboardService } from './dashboard.service';

/**
 * Trang Tổng quan theo vai trò (docs/DECISIONS.md #279). Mỗi vai trò có quyền RIÊNG (`dashboard.owner` ...) để tài khoản tuỳ biến chọn được ai xem trang nào; đợt này mới có
 * bản chủ phòng khám. Số liệu là tổng hợp theo CHI NHÁNH đang làm việc.
 */
@Controller('reports/dashboard')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('owner')
  @RequirePermission('dashboard', 'owner')
  async owner(@Query() query: unknown, @Req() req: Request) {
    const { period } = ownerDashboardQuerySchema.parse(query);
    return this.dashboardService.getOwnerDashboard(req.user!, period);
  }

  @Get('cashier')
  @RequirePermission('dashboard', 'cashier')
  async cashier(@Req() req: Request) {
    return this.dashboardService.getCashierDashboard(req.user!);
  }
}
