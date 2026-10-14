import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listClinicalOrdersQuerySchema } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { ClinicalOrderBookService } from './clinical-order-book.service';

/**
 * Menu "Phiếu chỉ định" (docs/DECISIONS.md #232) — danh sách phiếu chỉ định cận lâm sàng của CHI NHÁNH đang làm việc. Quyền `clinical_order.read` (lễ tân, điều dưỡng, bác sĩ, quản lý);
 * kỹ thuật viên không có quyền này (họ làm việc ở hàng đợi). Mở chi tiết/in một phiếu dùng lại `GET /encounters/:id/clinical-orders`.
 */
@Controller('clinical-orders')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ClinicalOrderBookController {
  constructor(private readonly service: ClinicalOrderBookService) {}

  @Get()
  @RequirePermission('clinical_order', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.service.list(tenantId, requireBranchId(req.user!), userId, req.dataScope!, listClinicalOrdersQuerySchema.parse(query));
  }
}
