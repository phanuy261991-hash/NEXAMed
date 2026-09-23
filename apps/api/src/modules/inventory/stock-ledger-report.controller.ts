import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getStockLedgerReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { StockLedgerReportService } from './stock-ledger-report.service';
import { StockLedgerReportExportService } from './stock-ledger-report-export.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — quyền RIÊNG `stock_receipt.report`
 * (chỉ `clinic_admin`, chốt qua AskUserQuestion lúc duyệt mockup — khác đề xuất ban đầu dùng chung
 * `stock_receipt.read`), đúng tinh thần `cash_voucher.report` của Sổ quỹ. */
@Controller('inventory/reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockLedgerReportController {
  constructor(
    private readonly reportService: StockLedgerReportService,
    private readonly exportService: StockLedgerReportExportService,
  ) {}

  @Get('stock-ledger')
  @RequirePermission('stock_receipt', 'report')
  async report(@Query() query: unknown, @Req() req: Request) {
    const dto = getStockLedgerReportQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.reportService.getReport(tenantId, dto);
  }

  @Get('stock-ledger/export')
  @RequirePermission('stock_receipt', 'report')
  async exportReport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = getStockLedgerReportQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const report = await this.reportService.getReport(tenantId, dto);
    const buffer = await this.exportService.buildStockLedgerReportExcel(dto.from, dto.to, report);
    await this.reportService.recordExportAudit(tenantId, userId, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="nhap-xuat-ton-${dto.from}_${dto.to}.xlsx"`);
    res.send(buffer);
  }
}
