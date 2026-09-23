import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveStockIssueRequestSchema,
  createManualStockIssueRequestSchema,
  createStockIssueRequestSchema,
  getPrescriptionDispenseStatusQuerySchema,
  listDispenseQueueQuerySchema,
  listStockIssuesQuerySchema,
  rejectStockIssueRequestSchema,
  updateManualStockIssueRequestSchema,
  voidStockIssueRequestSchema,
} from '@nexamed/shared';
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
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.list(tenantId, userId, req.dataScope!, dto);
  }

  @Get('issues/:id')
  @RequirePermission('stock_issue', 'read')
  @AuditView('stock_issue')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.getById(tenantId, userId, req.dataScope!, id);
  }

  @Post('issues')
  @RequirePermission('stock_issue', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.create(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Post('issues/:id/void')
  @RequirePermission('stock_issue', 'create')
  @HttpCode(200)
  async voidIssue(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = voidStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.voidIssue(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  // ============ "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170) — 3 loại Nháp→Duyệt lập tay
  // (Xuất dùng nội bộ/Xuất trả NCC/Xuất huỷ). Route RIÊNG `issues/manual*` khỏi `POST /issues` (luồng
  // "Phát thuốc" 1 bước, không đổi) — literal path `manual` không xung đột thứ tự với `:id` phía
  // trên (Express/NestJS khớp đoạn literal trước, đủ phân biệt với `:id` khác số đoạn đường dẫn).
  // ============

  @Post('issues/manual')
  @RequirePermission('stock_issue', 'create')
  @HttpCode(200)
  async createManual(@Body() body: unknown, @Req() req: Request) {
    const dto = createManualStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.createManual(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch('issues/manual/:id')
  @RequirePermission('stock_issue', 'create')
  async updateManual(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateManualStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.updateManual(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post('issues/manual/:id/approve')
  @RequirePermission('stock_issue', 'approve')
  @HttpCode(200)
  async approveManual(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.approveManual(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post('issues/manual/:id/reject')
  @RequirePermission('stock_issue', 'approve')
  @HttpCode(200)
  async rejectManual(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockIssueRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockIssueService.rejectManual(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
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
