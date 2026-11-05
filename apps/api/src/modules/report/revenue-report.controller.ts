import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { revenueByPeriodQuerySchema, revenuePeriodQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildRevenueByCashierExcel, buildRevenueByMethodExcel, buildRevenueByPeriodExcel, buildRevenueByServiceExcel, buildRevenueUnpaidExcel, type RevenueExcelContext } from './revenue-report-export';
import { RevenueReportService } from './revenue-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Doanh thu" (docs/DECISIONS.md #287): Theo kỳ, Theo nhóm và dịch vụ, Theo phương thức, Phiếu chưa thu, Theo thu ngân và chốt ca — mỗi báo cáo có một route xem và một route
 * `…/export` (Excel). Quyền: `revenue_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` — `ReportBranchScopeService` kiểm trong
 * service, thiếu quyền → 403 dù client tự gửi `scope=all`. Route cố định, không có route tham số.
 */
@Controller('reports/revenue')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RevenueReportController {
  constructor(private readonly service: RevenueReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: RevenueExcelContext, multiBranch: boolean) => Promise<Buffer>,
    extra: (report: T) => Record<string, unknown> = () => ({}),
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const buffer = await build(report, ctx, scope.branchIds.length > 1);
    await this.service.recordExportAudit(req.user!, reportName, report, scope.branchIds, extractRequestMeta(req), extra(report));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}-${report.from}-${report.to}.xlsx"`);
    res.send(buffer);
  }

  @Get('by-period')
  @RequirePermission('revenue_report', 'read')
  async byPeriod(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByPeriod(req.user!, revenueByPeriodQuerySchema.parse(query))).report;
  }

  @Get('by-period/export')
  @RequirePermission('revenue_report', 'read')
  async byPeriodExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = revenueByPeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'by_period', 'doanh-thu-theo-ky', (now) => this.service.getByPeriod(req.user!, dto, now), (r, ctx) => buildRevenueByPeriodExcel(r, ctx), (r) => ({ groupBy: r.groupBy }));
  }

  @Get('by-service')
  @RequirePermission('revenue_report', 'read')
  async byService(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByService(req.user!, revenuePeriodQuerySchema.parse(query))).report;
  }

  @Get('by-service/export')
  @RequirePermission('revenue_report', 'read')
  async byServiceExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = revenuePeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'by_service', 'doanh-thu-theo-dich-vu', (now) => this.service.getByService(req.user!, dto, now), (r, ctx) => buildRevenueByServiceExcel(r, ctx), (r) => ({ rowCount: r.rows.length }));
  }

  @Get('by-method')
  @RequirePermission('revenue_report', 'read')
  async byMethod(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByMethod(req.user!, revenuePeriodQuerySchema.parse(query))).report;
  }

  @Get('by-method/export')
  @RequirePermission('revenue_report', 'read')
  async byMethodExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = revenuePeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'by_method', 'doanh-thu-theo-phuong-thuc', (now) => this.service.getByMethod(req.user!, dto, now), (r, ctx) => buildRevenueByMethodExcel(r, ctx));
  }

  @Get('unpaid')
  @RequirePermission('revenue_report', 'read')
  async unpaid(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getUnpaid(req.user!, revenuePeriodQuerySchema.parse(query))).report;
  }

  @Get('unpaid/export')
  @RequirePermission('revenue_report', 'read')
  async unpaidExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = revenuePeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'unpaid', 'phieu-chua-thu', (now) => this.service.getUnpaid(req.user!, dto, now), (r, ctx, multi) => buildRevenueUnpaidExcel(r, multi, ctx), (r) => ({ invoiceCount: r.totalCount }));
  }

  @Get('by-cashier')
  @RequirePermission('revenue_report', 'read')
  async byCashier(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByCashier(req.user!, revenuePeriodQuerySchema.parse(query))).report;
  }

  @Get('by-cashier/export')
  @RequirePermission('revenue_report', 'read')
  async byCashierExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = revenuePeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'by_cashier', 'doanh-thu-theo-thu-ngan', (now) => this.service.getByCashier(req.user!, dto, now), (r, ctx, multi) => buildRevenueByCashierExcel(r, multi, ctx), (r) => ({ shiftCount: r.shiftTotal }));
  }
}
