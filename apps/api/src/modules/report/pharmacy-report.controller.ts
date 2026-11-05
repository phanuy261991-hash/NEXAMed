import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { controlledReportQuerySchema, pharmacyReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildPharmacyControlledExcel, buildPharmacyDispensedExcel, buildPharmacyMarginExcel, type PharmacyExcelContext } from './pharmacy-report-export';
import { PharmacyReportService } from './pharmacy-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287), 3 tab mới: Đã phát, Lãi gộp, Kiểm soát đặc biệt — mỗi báo cáo có một route xem và một route `…/export` (Excel). Quyền: `pharmacy_report.read`
 * (mặc định chỉ quản lý phòng khám vì có giá vốn). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` — `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù client tự gửi
 * `scope=all`. Bốn tab kho còn lại (Nhập-Xuất-Tồn, Tồn kho và hạn dùng, Hao hụt điều chuyển, Công nợ nhà cung cấp) giữ route và quyền cũ. Route cố định, không có route tham số.
 */
@Controller('reports/pharmacy')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PharmacyReportController {
  constructor(private readonly service: PharmacyReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: PharmacyExcelContext, multiBranch: boolean) => Promise<Buffer>,
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

  @Get('dispensed')
  @RequirePermission('pharmacy_report', 'read')
  async dispensed(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getDispensed(req.user!, pharmacyReportQuerySchema.parse(query))).report;
  }

  @Get('dispensed/export')
  @RequirePermission('pharmacy_report', 'read')
  async dispensedExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = pharmacyReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'dispensed', 'thuoc-vat-tu-da-phat', (now) => this.service.getDispensed(req.user!, dto, now), (r, ctx) => buildPharmacyDispensedExcel(r, ctx), (r) => ({ itemType: r.itemType, itemCount: r.itemCount }));
  }

  @Get('margin')
  @RequirePermission('pharmacy_report', 'read')
  async margin(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getMargin(req.user!, pharmacyReportQuerySchema.parse(query))).report;
  }

  @Get('margin/export')
  @RequirePermission('pharmacy_report', 'read')
  async marginExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = pharmacyReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'margin', 'lai-gop-thuoc-vat-tu', (now) => this.service.getMargin(req.user!, dto, now), (r, ctx) => buildPharmacyMarginExcel(r, ctx), (r) => ({ itemType: r.itemType, itemCount: r.totals.itemCount }));
  }

  @Get('controlled')
  @RequirePermission('pharmacy_report', 'read')
  async controlled(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getControlled(req.user!, controlledReportQuerySchema.parse(query))).report;
  }

  @Get('controlled/export')
  @RequirePermission('pharmacy_report', 'read')
  async controlledExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = controlledReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'controlled', 'thuoc-kiem-soat-dac-biet', (now) => this.service.getControlled(req.user!, dto, now), (r, ctx, multi) => buildPharmacyControlledExcel(r, multi, ctx), (r) => ({ controlType: r.controlType, entryCount: r.entryCount }));
  }
}
