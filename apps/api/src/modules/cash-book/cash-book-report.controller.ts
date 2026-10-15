import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { cashBookLedgerAccountsQuerySchema, cashFlowReportQuerySchema, getCashBookLedgerQuerySchema, listCashVouchersQuerySchema } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { ReportBranchScopeService } from '../../common/report-branch-scope.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
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
    private readonly reportBranchScope: ReportBranchScopeService,
  ) {}

  /** Ô "Quỹ" của Sổ quỹ: quỹ chi nhánh đang làm, hoặc `?scope=all` = quỹ MỌI chi nhánh (cần `company_report.read`, Đợt 3 #235). */
  @Get('ledger/accounts')
  @RequirePermission('cash_voucher', 'read')
  async ledgerAccounts(@Query() query: unknown, @Req() req: Request) {
    return this.reportService.listLedgerAccounts(req.user!, cashBookLedgerAccountsQuerySchema.parse(query));
  }

  @Get('ledger')
  @RequirePermission('cash_voucher', 'read')
  async ledger(@Query() query: unknown, @Req() req: Request) {
    const dto = getCashBookLedgerQuerySchema.parse(query);
    return this.reportService.getLedger(req.user!, dto.cashAccountId, dto.from, dto.to);
  }

  /** "Xuất Excel" cho "Sổ quỹ" — cùng quyền `cash_voucher.read` với `ledger()` (tra cứu vận hành
   * hằng ngày, KHÔNG phải báo cáo quản trị tổng hợp — khác `cash_voucher.report`). Đặt TRƯỚC
   * `ledger()` không cần thiết (khác path cố định `ledger/export`, không đụng `:id`). */
  @Get('ledger/export')
  @RequirePermission('cash_voucher', 'read')
  async exportLedger(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = getCashBookLedgerQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const ledger = await this.reportService.getLedger(req.user!, dto.cashAccountId, dto.from, dto.to);
    const buffer = await this.exportService.buildCashBookLedgerExcel(ledger, dto.from, dto.to);
    await this.reportService.recordExportAudit(tenantId, userId, 'cash_book_ledger.exported', dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="so-quy-${dto.from ?? 'tat-ca'}_${dto.to ?? 'tat-ca'}.xlsx"`);
    res.send(buffer);
  }

  /** "Xuất Excel" cho "Phiếu thu / Phiếu chi" — cùng quyền `cash_voucher.read` với danh sách
   * (`CashVoucherController.list()`), đúng bộ lọc đang xem trên `CashVoucherListPage.tsx`. */
  @Get('vouchers/export')
  @RequirePermission('cash_voucher', 'read')
  async exportVouchers(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = listCashVouchersQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const data = await this.reportService.getVoucherExportData(tenantId, requireBranchId(req.user!), dto);
    const buffer = await this.exportService.buildCashVoucherListExcel(dto.from, dto.to, data);
    await this.reportService.recordExportAudit(tenantId, userId, 'cash_voucher.exported', dto, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="phieu-thu-chi-${dto.from ?? 'tat-ca'}_${dto.to ?? 'tat-ca'}.xlsx"`);
    res.send(buffer);
  }

  @Get('cash-flow-report')
  @RequirePermission('cash_voucher', 'report')
  async cashFlowReport(@Query() query: unknown, @Req() req: Request) {
    return (await this.loadCashFlowReport(query, req)).report;
  }

  @Get('cash-flow-report/export')
  @RequirePermission('cash_voucher', 'report')
  async exportCashFlowReport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const { dto, scope, report } = await this.loadCashFlowReport(query, req);
    const { userId, tenantId } = req.user!;
    const buffer = await this.exportService.buildCashFlowReportExcel(dto.from, dto.to, report);
    // Audit ghi cả phạm vi người dùng chọn lẫn danh sách chi nhánh thật đã xuất — để truy vết "ai xuất dữ liệu chi nhánh nào".
    await this.reportService.recordExportAudit(tenantId, userId, 'cash_flow_report.exported', { ...dto, resolvedBranchIds: scope.branchIds }, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-dong-tien-${dto.from}_${dto.to}.xlsx"`);
    res.send(buffer);
  }

  /** Dùng chung cho xem + xuất Excel: parse query, kiểm phạm vi chi nhánh theo quyền (`company_report.read` nếu không phải `current`), rồi dựng báo cáo. */
  private async loadCashFlowReport(query: unknown, req: Request) {
    const dto = cashFlowReportQuerySchema.parse(query);
    const scope = await this.reportBranchScope.resolve(req.user!, dto);
    const report = await this.reportService.getCashFlowReport(req.user!.tenantId, scope, dto.from, dto.to);
    return { dto, scope, report };
  }
}
