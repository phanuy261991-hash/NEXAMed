import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { serviceConsumptionReportQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildServiceConsumptionByCustomerExcel, buildServiceConsumptionByServiceExcel, type ServiceConsumptionExcelContext } from './service-consumption-report-export';
import { ServiceConsumptionReportService } from './service-consumption-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9), 2 tab: Theo dịch vụ, Theo khách — mỗi tab một route xem và một route `…/export` (Excel). Quyền `service_consumption.report`
 * (mặc định chỉ quản lý phòng khám vì có giá vốn). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` — `ReportBranchScopeService` kiểm trong service. Route cố định, không có route tham số.
 */
@Controller('reports/service-consumption')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ServiceConsumptionReportController {
  constructor(private readonly service: ServiceConsumptionReportService) {}

  private async exportReport<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: ServiceConsumptionExcelContext, multiBranch: boolean) => Promise<Buffer>,
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const buffer = await build(report, ctx, scope.branchIds.length > 1);
    await this.service.recordExportAudit(req.user!, reportName, report, scope.branchIds, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}-${report.from}-${report.to}.xlsx"`);
    res.send(buffer);
  }

  @Get('by-service')
  @RequirePermission('service_consumption', 'report')
  async byService(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByService(req.user!, serviceConsumptionReportQuerySchema.parse(query))).report;
  }

  @Get('by-service/export')
  @RequirePermission('service_consumption', 'report')
  async byServiceExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = serviceConsumptionReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'by-service', 'chi-phi-vat-tu-theo-dich-vu', (now) => this.service.getByService(req.user!, dto, now), (r, ctx) => buildServiceConsumptionByServiceExcel(r, ctx));
  }

  @Get('by-customer')
  @RequirePermission('service_consumption', 'report')
  async byCustomer(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getByCustomer(req.user!, serviceConsumptionReportQuerySchema.parse(query))).report;
  }

  @Get('by-customer/export')
  @RequirePermission('service_consumption', 'report')
  async byCustomerExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = serviceConsumptionReportQuerySchema.parse(query);
    await this.exportReport(req, res, 'by-customer', 'chi-phi-vat-tu-theo-khach', (now) => this.service.getByCustomer(req.user!, dto, now), (r, ctx, multi) => buildServiceConsumptionByCustomerExcel(r, multi, ctx));
  }
}
