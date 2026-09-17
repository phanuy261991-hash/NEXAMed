import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { getDrugBatchBalancesQuerySchema, listStockBalancesQuerySchema, listStockExpiryWarningsQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { StockBalanceService } from './stock-balance.service';

/** "Tồn kho" (view Theo mặt hàng / Cảnh báo hạn dùng) + "Tồn kho theo lô" (panel chi tiết thuốc),
 * Kho Thuốc GĐ2. */
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockBalanceController {
  constructor(private readonly stockBalanceService: StockBalanceService) {}

  @Get('balances')
  @RequirePermission('stock_receipt', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockBalancesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.list(tenantId, dto);
  }

  @Get('drugs/:drugId/balances')
  @RequirePermission('stock_receipt', 'read')
  async getForDrug(@Param('drugId') drugId: string, @Query() query: unknown, @Req() req: Request) {
    const dto = getDrugBatchBalancesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.getForDrug(tenantId, drugId, dto.warehouseId);
  }

  @Get('expiry-warnings')
  @RequirePermission('stock_receipt', 'read')
  async listExpiryWarnings(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockExpiryWarningsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.listExpiryWarnings(tenantId, dto);
  }
}
