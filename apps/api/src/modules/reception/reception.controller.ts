import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { checkInRequestSchema, receptionListQuerySchema, recordVitalSignRequestSchema, registerReceptionRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { ReceptionService } from './reception.service';
import { ReceptionExportService } from './reception-export.service';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('reception')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReceptionController {
  constructor(
    private readonly receptionService: ReceptionService,
    private readonly receptionExportService: ReceptionExportService,
  ) {}

  @Post('check-in')
  @RequirePermission('encounter', 'create')
  @HttpCode(200)
  async checkIn(@Body() body: unknown, @Req() req: Request) {
    const dto = checkInRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.checkIn(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  /** "Tiếp nhận bệnh nhân" — tạo `encounter` trực tiếp, khách không qua đặt lịch trước. */
  @Post('direct')
  @RequirePermission('encounter', 'create')
  @HttpCode(200)
  async registerDirect(@Body() body: unknown, @Req() req: Request) {
    const dto = registerReceptionRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.registerDirect(tenantId, userId, dto, extractRequestMeta(req));
  }

  /** "Danh sách tiếp nhận" (mặc định) / "Hàng đợi khám" (khi truyền `doctorId`) — cùng nguồn dữ liệu. */
  @Get('list')
  @RequirePermission('encounter', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = receptionListQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.receptionService.listReceptions(tenantId, userId, req.dataScope!, dto.date, dto.doctorId, dto.includeDepartmentPool, dto.queueView);
  }

  /** "Xuất Excel" — LUÔN toàn bộ trong ngày (bỏ qua tab/tìm kiếm đang chọn), cùng quyền `encounter.read`
   * với `list()`. Đặt path riêng `list/export`, không đụng `list` (khác tiền tố, không có `:id` trong
   * controller này nên không cần lo thứ tự khai báo route). */
  @Get('list/export')
  @RequirePermission('encounter', 'read')
  async exportList(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = receptionListQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const { targetDate, items, doctorNameById, departmentNameById } = await this.receptionService.getReceptionListForExport(
      tenantId,
      userId,
      req.dataScope!,
      dto.date,
    );
    const buffer = await this.receptionExportService.buildReceptionListExcel(targetDate, items, doctorNameById, departmentNameById);
    await this.receptionService.recordReceptionListExportAudit(tenantId, userId, targetDate, extractRequestMeta(req));
    res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="benh-nhan-trong-ngay-${targetDate}.xlsx"`);
    res.send(buffer);
  }

  @Post('encounters/:encounterId/vital-signs')
  @RequirePermission('vital_sign', 'create', { entityIdParam: 'encounterId' })
  @HttpCode(200)
  async recordVitalSigns(@Param('encounterId') encounterId: string, @Body() body: unknown, @Req() req: Request) {
    const dto = recordVitalSignRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.receptionService.recordVitalSigns(tenantId, userId, req.dataScope!, encounterId, dto, extractRequestMeta(req));
  }
}
