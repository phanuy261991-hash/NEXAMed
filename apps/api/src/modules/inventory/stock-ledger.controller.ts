import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { getDrugLedgerQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { StockLedgerService } from './stock-ledger.service';

/** "Thẻ kho"/"Lịch sử giao dịch" trong panel chi tiết thuốc (Kho Thuốc GĐ2). */
@Controller('inventory/drugs')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockLedgerController {
  constructor(private readonly stockLedgerService: StockLedgerService) {}

  @Get(':drugId/ledger')
  @RequirePermission('stock_receipt', 'read')
  async getLedger(@Param('drugId') drugId: string, @Query() query: unknown, @Req() req: Request) {
    const dto = getDrugLedgerQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockLedgerService.getForDrug(tenantId, drugId, dto);
  }
}
