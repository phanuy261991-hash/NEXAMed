import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { systemMonthlyQuerySchema, systemPeriodQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildSystemCrossExcel, buildSystemMonthlyExcel, buildSystemOverviewExcel, buildSystemRankingExcel, type SystemExcelContext } from './system-report-export';
import { SystemReportService } from './system-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287): So sánh chi nhánh, Xếp hạng, Tổng hợp tháng, Khám chéo chi nhánh — mỗi báo cáo có một route xem và một route `…/export` (Excel). Quyền:
 * `company_report.read` ("Xem báo cáo toàn công ty", #235), mặc định chỉ quản lý phòng khám. Phạm vi chi nhánh vẫn do `ReportBranchScopeService` kiểm (id lạ → 404); người có quyền này mặc định xem
 * chi nhánh đang làm nếu client không gửi `scope`. Route cố định, không có route tham số.
 */
@Controller('reports/system')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SystemReportController {
  constructor(private readonly service: SystemReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: SystemExcelContext, multiBranch: boolean) => Promise<Buffer>,
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

  @Get('overview')
  @RequirePermission('company_report', 'read')
  async overview(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getOverview(req.user!, systemPeriodQuerySchema.parse(query))).report;
  }

  @Get('overview/export')
  @RequirePermission('company_report', 'read')
  async overviewExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = systemPeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'overview', 'toan-he-thong-so-sanh-chi-nhanh', (now) => this.service.getOverview(req.user!, dto, now), (r, ctx) => buildSystemOverviewExcel(r, ctx));
  }

  @Get('ranking')
  @RequirePermission('company_report', 'read')
  async ranking(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getRanking(req.user!, systemPeriodQuerySchema.parse(query))).report;
  }

  @Get('ranking/export')
  @RequirePermission('company_report', 'read')
  async rankingExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = systemPeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'ranking', 'toan-he-thong-xep-hang', (now) => this.service.getRanking(req.user!, dto, now), (r, ctx) => buildSystemRankingExcel(r, ctx));
  }

  @Get('monthly')
  @RequirePermission('company_report', 'read')
  async monthly(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getMonthly(req.user!, systemMonthlyQuerySchema.parse(query))).report;
  }

  @Get('monthly/export')
  @RequirePermission('company_report', 'read')
  async monthlyExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = systemMonthlyQuerySchema.parse(query);
    await this.exportReport(req, res, 'monthly', 'toan-he-thong-tong-hop-thang', (now) => this.service.getMonthly(req.user!, dto, now), (r, ctx) => buildSystemMonthlyExcel(r, ctx), (r) => ({ month: r.month }));
  }

  @Get('cross')
  @RequirePermission('company_report', 'read')
  async cross(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getCross(req.user!, systemPeriodQuerySchema.parse(query))).report;
  }

  @Get('cross/export')
  @RequirePermission('company_report', 'read')
  async crossExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = systemPeriodQuerySchema.parse(query);
    await this.exportReport(req, res, 'cross', 'toan-he-thong-kham-cheo-chi-nhanh', (now) => this.service.getCross(req.user!, dto, now), (r, ctx) => buildSystemCrossExcel(r, ctx), (r) => ({ crossPatientCount: r.totals.crossPatientCount }));
  }
}
