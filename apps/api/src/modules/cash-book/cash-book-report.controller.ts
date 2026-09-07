import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { cashFlowReportQuerySchema, getCashBookLedgerQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { CashBookReportService } from './cash-book-report.service';
import { CashBookExportService } from './cash-book-export.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * "Sổ quỹ & Thu chi" Giai đoạn 2 — Sổ quỹ (`cash_voucher.read`, tra cứu vận hành hằng ngày, đúng
 * quyền `CashVoucherController`) + Báo cáo dòng tiền (`cash_voucher.report`, MỚI, chỉ
 * `clinic_admin` — báo cáo quản trị tổng hợp toàn phòng khám, đúng tinh thần `cashier_shift.manage`).
 */
@Controller('cash-book')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CashBookReportController {
  constructor(
    private readonly reportService: CashBookReportService,
    private readonly exportService: CashBookExportService,
  ) {}

  @Get('ledger')
  @RequirePermission('cash_voucher', 'read')
  async ledger(@Query() query: unknown, @Req() req: Request) {
    const dto = getCashBookLedgerQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.reportService.getLedger(tenantId, dto.cashAccountId, dto.from, dto.to);
  }

  @Get('cash-flow-report')
  @RequirePermission('cash_voucher', 'report')
  async cashFlowReport(@Query() query: unknown, @Req() req: Request) {
    const dto = cashFlowReportQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.reportService.getCashFlowReport(tenantId, dto.from, dto.to);
  }

  @Get('cash-flow-report/export')
  @RequirePermission('cash_voucher', 'report')
  async exportCashFlowReport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = cashFlowReportQuerySchema.parse(query);
    const { tenantId } = req.user!;
    const report = await this.reportService.getCashFlowReport(tenantId, dto.from, dto.to);
    const buffer = await this.exportService.buildCashFlowReportExcel(dto.from, dto.to, report);
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-dong-tien-${dto.from}_${dto.to}.xlsx"`);
    res.send(buffer);
  }
}
