import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { createStockIssueRequestSchema, getPrescriptionDispenseStatusQuerySchema, listDispenseQueueQuerySchema, listStockIssuesQuerySchema, voidStockIssueRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { StockIssueService } from './stock-issue.service';

/**
 * "Phiếu xuất kho" (Kho Thuốc GĐ3, docs/DECISIONS.md #163) — luồng 1 BƯỚC (khác `stock_receipt`
 * Nháp→Duyệt), không có `entityIdParam` break-glass (cùng lý do `stock_receipt`: dữ liệu vận hành
 * kho, không phải lâm sàng khẩn cấp). `@Controller('inventory')` (không riêng `inventory/issues`)
 * để gộp chung 2 endpoint chiếu "Phát thuốc" (`prescriptions/:id/dispense-status`,
 * `dispense-queue`) không thuộc tiền tố `issues`.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockIssueController {
  constructor(private readonly stockIssueService: StockIssueService) {}

  @Get('issues')
  @RequirePermission('stock_issue', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockIssuesQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockIssueService.list(tenantId, dto);
  }

  @Get('issues/:id')
  @RequirePermission('stock_issue', 'read')
  @AuditView('stock_issue')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.stockIssueService.getById(tenantId, id);
  }

  @Post('issues')
  @RequirePermission('stock_issue', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Post('issues/:id/void')
  @RequirePermission('stock_issue', 'create')
  @HttpCode(200)
  async voidIssue(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = voidStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.voidIssue(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Get('prescriptions/:prescriptionId/dispense-status')
  @RequirePermission('stock_issue', 'read')
  async dispenseStatus(@Param('prescriptionId') prescriptionId: string, @Query() query: unknown, @Req() req: Request) {
    const dto = getPrescriptionDispenseStatusQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockIssueService.getDispenseStatus(tenantId, prescriptionId, dto.warehouseId);
  }

  @Get('dispense-queue')
  @RequirePermission('stock_issue', 'read')
  async dispenseQueue(@Query() query: unknown, @Req() req: Request) {
    const dto = listDispenseQueueQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockIssueService.listDispenseQueue(tenantId, dto);
  }
}
