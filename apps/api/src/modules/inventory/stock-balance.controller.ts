import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getDrugBatchBalancesQuerySchema, getStockOnHandSummaryQuerySchema, listStockBalancesQuerySchema, listStockExpiryWarningsQuerySchema } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { StockBalanceExportService } from './stock-balance-export.service';
import { StockBalanceService } from './stock-balance.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** "Tồn kho" (view Theo mặt hàng / Cảnh báo hạn dùng) + "Tồn kho theo lô" (panel chi tiết thuốc),
 * Kho Thuốc GĐ2. */
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockBalanceController {
  constructor(
    private readonly stockBalanceService: StockBalanceService,
    private readonly exportService: StockBalanceExportService,
  ) {}

  @Get('balances')
  @RequirePermission('stock_receipt', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockBalancesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.list(tenantId, requireBranchId(req.user!), dto);
  }

  /** Kho Thuốc GĐ5 — "tổng tồn toàn phòng khám" cho một danh sách thuốc, dùng cho `DrugPicker.tsx`/
   * `PrescriptionPanel.tsx` (bác sĩ/điều dưỡng đã có `stock_receipt.read` từ GĐ2, chuẩn bị sẵn cho
   * đúng mục đích này). Đặt TRƯỚC `@Get('drugs/:drugId/balances')` không cần thiết (khác path cố
   * định `balances/on-hand-summary`, không phải `:id`), nhưng đặt gần cho dễ đọc. */
  /** Xuất Excel "Tồn kho và hạn dùng" đúng bộ lọc đang xem (docs/DECISIONS.md #287) — cùng quyền `stock_receipt.read`, chi nhánh đang làm việc; ghi nhật ký xuất. */
  @Get('balances/export')
  @RequirePermission('stock_receipt', 'read')
  async exportBalances(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = listStockBalancesQuerySchema.parse(query);
    const buffer = await this.exportService.exportExcel(req.user!, dto);
    await this.exportService.recordExportAudit(req.user!, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="ton-kho.xlsx"');
    res.send(buffer);
  }

  @Get('balances/on-hand-summary')
  @RequirePermission('stock_receipt', 'read')
  async getOnHandSummary(@Query() query: unknown, @Req() req: Request) {
    const dto = getStockOnHandSummaryQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.getOnHandSummary(tenantId, requireBranchId(req.user!), dto.drugIds);
  }

  @Get('drugs/:drugId/balances')
  @RequirePermission('stock_receipt', 'read')
  async getForDrug(@Param('drugId') drugId: string, @Query() query: unknown, @Req() req: Request) {
    const dto = getDrugBatchBalancesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.getForDrug(tenantId, requireBranchId(req.user!), drugId, dto.warehouseId);
  }

  @Get('expiry-warnings')
  @RequirePermission('stock_receipt', 'read')
  async listExpiryWarnings(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockExpiryWarningsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockBalanceService.listExpiryWarnings(tenantId, requireBranchId(req.user!), dto);
  }
}
