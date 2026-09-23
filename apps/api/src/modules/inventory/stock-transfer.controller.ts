import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import {
  createStockTransferRequestSchema,
  listStockTransfersQuerySchema,
  receiveStockTransferRequestSchema,
  rejectStockTransferRequestSchema,
  shipStockTransferRequestSchema,
  updateStockTransferRequestSchema,
} from '@nexamed/shared';
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
    return this.stockTransferService.list(tenantId, userId, req.dataScope!, dto);
  }

  @Get(':id')
  @RequirePermission('stock_transfer', 'read')
  @AuditView('stock_transfer')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.getById(tenantId, userId, req.dataScope!, id);
  }

  @Post()
  @RequirePermission('stock_transfer', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.create(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('stock_transfer', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.update(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/ship')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async ship(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = shipStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.approveShip(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.reject(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/receive')
  @RequirePermission('stock_transfer', 'approve')
  @HttpCode(200)
  async receive(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = receiveStockTransferRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockTransferService.confirmReceive(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
