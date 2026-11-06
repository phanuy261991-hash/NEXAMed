import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { qualityIncompleteQuerySchema, qualityInteropQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildQualityIncompleteExcel, buildQualityInteropExcel } from './quality-report-export';
import { QualityReportService } from './quality-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290): Lượt khám chưa hoàn tất và Liên thông đơn thuốc — mỗi báo cáo có một route xem và một route `…/export` (Excel). Tab "Nhật ký kiểm toán"
 * dẫn sang trang cũ nên không có route ở đây. Quyền: `quality_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` —
 * `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù client tự gửi `scope=all`. Route cố định, không có route tham số.
 */
@Controller('reports/quality')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class QualityReportController {
  constructor(private readonly service: QualityReportService) {}

  private async exportReport<T>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    range: (report: T) => { from: string; to: string },
    build: (report: T, ctx: ReportExportContext) => Promise<Buffer>,
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const buffer = await build(report, ctx);
    const { from, to } = range(report);
    await this.service.recordExportAudit(req.user!, reportName, { from, to }, scope.branchIds, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}-${from === to ? from : `${from}-${to}`}.xlsx"`);
    res.send(buffer);
  }

  @Get('incomplete')
  @RequirePermission('quality_report', 'read')
  async incomplete(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getIncomplete(req.user!, qualityIncompleteQuerySchema.parse(query))).report;
  }

  @Get('incomplete/export')
  @RequirePermission('quality_report', 'read')
  async incompleteExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = qualityIncompleteQuerySchema.parse(query);
    await this.exportReport(req, res, 'incomplete', 'luot-kham-chua-hoan-tat', (now) => this.service.getIncomplete(req.user!, dto, now), (r) => ({ from: r.asOf, to: r.asOf }), buildQualityIncompleteExcel);
  }

  @Get('interop')
  @RequirePermission('quality_report', 'read')
  async interop(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getInterop(req.user!, qualityInteropQuerySchema.parse(query))).report;
  }

  @Get('interop/export')
  @RequirePermission('quality_report', 'read')
  async interopExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = qualityInteropQuerySchema.parse(query);
    await this.exportReport(req, res, 'interop', 'lien-thong-don-thuoc', (now) => this.service.getInterop(req.user!, dto, now), (r) => ({ from: r.from, to: r.to }), buildQualityInteropExcel);
  }
}
