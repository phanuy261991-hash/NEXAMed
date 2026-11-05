import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { operationsPeriodQuerySchema, visitBookExportQuerySchema, visitBookQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import type { ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildBookingSourceExcel, buildCancellationExcel, buildFollowUpExcel, buildPeakHoursExcel, buildVisitBookExcel, buildWaitingExcel } from './operations-report-export';
import { OperationsReportService } from './operations-report.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287): Sổ khám bệnh, giờ cao điểm, thời gian chờ, huỷ và không đến, tái khám, nguồn đặt lịch — mỗi báo cáo có một
 * route xem và một route `…/export` (Excel). Quyền: `operations_report.read` (mặc định chỉ quản lý phòng khám). Gộp từ hai chi nhánh trở lên cần THÊM `company_report.read` —
 * `ReportBranchScopeService` kiểm trong service, thiếu quyền → 403 dù client tự gửi `scope=all`. Route cố định khai báo trước, không có route tham số.
 */
@Controller('reports/operations')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OperationsReportController {
  constructor(private readonly service: OperationsReportService) {}

  private send(res: Response, buffer: Buffer, fileName: string): void {
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  // ---- Sổ khám bệnh ----

  @Get('visit-book')
  @RequirePermission('operations_report', 'read')
  async visitBook(@Query() query: unknown, @Req() req: Request) {
    return this.service.listVisitBook(req.user!, visitBookQuerySchema.parse(query));
  }

  @Get('visit-book/export')
  @RequirePermission('operations_report', 'read')
  async visitBookExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = visitBookExportQuerySchema.parse(query);
    const now = new Date();
    const { rows, total, scope } = await this.service.loadVisitBookForExport(req.user!, dto);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const filterLines = [dto.icd10Code ? `Chẩn đoán chính: ${dto.icd10Code.toUpperCase()}` : null, dto.doctorId ? 'Đã lọc theo một bác sĩ' : null, dto.q ? `Tìm: ${dto.q}` : null].filter((l): l is string => l !== null);
    const buffer = await buildVisitBookExcel(rows, total, filterLines, dto, scope.branchIds.length > 1, ctx);
    await this.service.recordExportAudit(req.user!, 'visit_book', dto, scope.branchIds, extractRequestMeta(req), { doctorFiltered: !!dto.doctorId, icd10Filtered: !!dto.icd10Code, hasSearch: !!dto.q, rowCount: rows.length });
    this.send(res, buffer, `so-kham-benh-${dto.from}-${dto.to}.xlsx`);
  }

  // ---- Báo cáo tổng hợp theo kỳ ----

  private async exportAggregate<T extends { from: string; to: string }>(
    req: Request,
    res: Response,
    reportName: string,
    fileStem: string,
    load: (now: Date) => Promise<{ report: T; scope: ReportBranchScope }>,
    build: (report: T, ctx: Awaited<ReturnType<OperationsReportService['exportContext']>>) => Promise<Buffer>,
  ): Promise<void> {
    const now = new Date();
    const { report, scope } = await load(now);
    const ctx = await this.service.exportContext(req.user!, scope, now);
    const buffer = await build(report, ctx);
    await this.service.recordExportAudit(req.user!, reportName, report, scope.branchIds, extractRequestMeta(req));
    this.send(res, buffer, `${fileStem}-${report.from}-${report.to}.xlsx`);
  }

  @Get('peak-hours')
  @RequirePermission('operations_report', 'read')
  async peakHours(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getPeakHours(req.user!, operationsPeriodQuerySchema.parse(query))).report;
  }

  @Get('peak-hours/export')
  @RequirePermission('operations_report', 'read')
  async peakHoursExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = operationsPeriodQuerySchema.parse(query);
    await this.exportAggregate(req, res, 'peak_hours', 'gio-cao-diem', (now) => this.service.getPeakHours(req.user!, dto, now), buildPeakHoursExcel);
  }

  @Get('waiting')
  @RequirePermission('operations_report', 'read')
  async waiting(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getWaiting(req.user!, operationsPeriodQuerySchema.parse(query))).report;
  }

  @Get('waiting/export')
  @RequirePermission('operations_report', 'read')
  async waitingExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = operationsPeriodQuerySchema.parse(query);
    await this.exportAggregate(req, res, 'waiting', 'thoi-gian-cho', (now) => this.service.getWaiting(req.user!, dto, now), buildWaitingExcel);
  }

  @Get('cancellations')
  @RequirePermission('operations_report', 'read')
  async cancellations(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getCancellations(req.user!, operationsPeriodQuerySchema.parse(query))).report;
  }

  @Get('cancellations/export')
  @RequirePermission('operations_report', 'read')
  async cancellationsExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = operationsPeriodQuerySchema.parse(query);
    await this.exportAggregate(req, res, 'cancellations', 'huy-va-khong-den', (now) => this.service.getCancellations(req.user!, dto, now), buildCancellationExcel);
  }

  @Get('follow-ups')
  @RequirePermission('operations_report', 'read')
  async followUps(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getFollowUps(req.user!, operationsPeriodQuerySchema.parse(query))).report;
  }

  @Get('follow-ups/export')
  @RequirePermission('operations_report', 'read')
  async followUpsExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = operationsPeriodQuerySchema.parse(query);
    await this.exportAggregate(req, res, 'follow_ups', 'tai-kham', (now) => this.service.getFollowUps(req.user!, dto, now), buildFollowUpExcel);
  }

  @Get('booking-sources')
  @RequirePermission('operations_report', 'read')
  async bookingSources(@Query() query: unknown, @Req() req: Request) {
    return (await this.service.getBookingSources(req.user!, operationsPeriodQuerySchema.parse(query))).report;
  }

  @Get('booking-sources/export')
  @RequirePermission('operations_report', 'read')
  async bookingSourcesExport(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = operationsPeriodQuerySchema.parse(query);
    await this.exportAggregate(req, res, 'booking_sources', 'nguon-dat-lich', (now) => this.service.getBookingSources(req.user!, dto, now), buildBookingSourceExcel);
  }
}
