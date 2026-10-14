import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import {
  confirmStockTransferReturnRequestSchema,
  createStockTransferRequestSchema,
  getStockTransferShrinkageQuerySchema,
  listStockTransfersQuerySchema,
  receiveStockTransferRequestSchema,
  rejectStockTransferReceiptRequestSchema,
  rejectStockTransferRequestSchema,
  resolveStockTransferVarianceRequestSchema,
  shipStockTransferRequestSchema,
  updateStockTransferRequestSchema,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { StockTransferService } from './stock-transfer.service';

/**
 * "Phiếu điều chuyển kho" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — không gắn `entityIdParam` cho
 * break-glass, cùng lý do `stock_receipt`/`stock_count` (dữ liệu vận hành kho, không phải lâm sàng
 * khẩn cấp).
 *
 * Phân quyền theo Khoa/Phòng (mục 0 kế hoạch kỹ thuật #170) — mọi handler đọc `req.dataScope!` (đã
 * được `PermissionGuard` gán sẵn) và truyền xuống Service, đúng khuôn `stock-count.controller.ts`.
 * Dùng CHUNG 1 quyền `approve` cho cả 3 hành động ghi trạng thái (Duyệt xuất/Từ chối/Xác nhận nhận
 * hàng) — Service tự kiểm đúng kho của từng bước theo `dataScope`.
 */
@Controller('inventory/transfers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockTransferController {
  constructor(private readonly stockTransferService: StockTransferService) {}

  @Get()
  @RequirePermission('stock_transfer', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockTransfersQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.list(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto);
  }

  /** Chấm số trên menu: phiếu đang chờ NHẬN ở chi nhánh này + phiếu chờ chi nhánh này (bên gửi) xử lý. Đặt TRƯỚC `:id`. */
  @Get('pending-counts')
  @RequirePermission('stock_transfer', 'read')
  async pendingCounts(@Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.getPendingCounts(tenantId, requireBranchId(req.user!), userId, req.dataScope!);
  }

  /** "Báo cáo hao hụt điều chuyển" — quyền RIÊNG `stock_receipt.report` (cùng nhóm báo cáo Nhập-Xuất-Tồn). Đặt TRƯỚC `:id`. */
  @Get('shrinkage-report')
  @RequirePermission('stock_receipt', 'report')
  async shrinkageReport(@Query() query: unknown, @Req() req: Request) {
    const dto = getStockTransferShrinkageQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockTransferService.getShrinkageReport(tenantId, requireBranchId(req.user!), dto);
  }

  @Get(':id')
  @RequirePermission('stock_transfer', 'read')
  @AuditView('stock_transfer')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.getById(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id);
  }

  @Post()
  @RequirePermission('stock_transfer', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.create(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('stock_transfer', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.update(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/ship')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async ship(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = shipStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.approveShip(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.reject(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/receive')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async receive(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = receiveStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.confirmReceive(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Bên NHẬN từ chối nhận cả phiếu (IN_TRANSIT→RETURNING). */
  @Post(':id/reject-receipt')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async rejectReceipt(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockTransferReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.rejectReceipt(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Bên GỬI xác nhận đã nhận lại hàng bị từ chối (RETURNING→RETURNED). */
  @Post(':id/confirm-return')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async confirmReturn(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = confirmStockTransferReturnRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.confirmReturn(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  /** Bên GỬI xử lý phần nhận thiếu (VARIANCE_PENDING→COMPLETED). */
  @Post(':id/resolve-variance')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async resolveVariance(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = resolveStockTransferVarianceRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.resolveVariance(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
