import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listSupplierDebtLedgerQuerySchema, recordSupplierDebtOpeningBalanceRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { SupplierDebtService } from './supplier-debt.service';

/** "Công nợ nhà cung cấp" — Phần A (docs/DECISIONS.md #180/#182). `:supplierId` khai TRƯỚC
 * `/summaries` không xung đột vì Nest so khớp theo path CỤ THỂ hơn trước — nhưng để tránh mọi nhầm
 * lẫn thứ tự (bài học S2-03 patient/check-duplicate), khai `summaries` (route cố định) TRƯỚC các
 * route có `:supplierId`. */
@Controller('supplier-debt')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SupplierDebtController {
  constructor(private readonly supplierDebtService: SupplierDebtService) {}

  @Get('summaries')
  @RequirePermission('supplier_debt', 'read')
  async listSummaries(@Query('includeInactive') includeInactive: string | undefined, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.supplierDebtService.listSummaries(tenantId, includeInactive === 'true');
  }

  @Get(':supplierId/summary')
  @RequirePermission('supplier_debt', 'read')
  async getSummary(@Param('supplierId') supplierId: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.supplierDebtService.getSummary(tenantId, supplierId);
  }

  @Get(':supplierId/ledger')
  @RequirePermission('supplier_debt', 'read')
  async getLedger(@Param('supplierId') supplierId: string, @Query() query: unknown, @Req() req: Request) {
    const dto = listSupplierDebtLedgerQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.supplierDebtService.listLedger(tenantId, supplierId, dto);
  }

  @Get(':supplierId/receipts')
  @RequirePermission('supplier_debt', 'read')
  async getReceiptStatuses(@Param('supplierId') supplierId: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.supplierDebtService.listReceiptStatuses(tenantId, supplierId);
  }

  @Post(':supplierId/opening-balance')
  @RequirePermission('supplier_debt', 'pay')
  @HttpCode(200)
  async recordOpeningBalance(@Param('supplierId') supplierId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = recordSupplierDebtOpeningBalanceRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.supplierDebtService.recordOpeningBalance(tenantId, userId, supplierId, dto, extractRequestMeta(req));
  }
}
