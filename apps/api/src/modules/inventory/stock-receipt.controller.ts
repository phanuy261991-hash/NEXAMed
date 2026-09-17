import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import {
  approveStockReceiptRequestSchema,
  createStockReceiptRequestSchema,
  listStockReceiptsQuerySchema,
  rejectStockReceiptRequestSchema,
  updateStockReceiptRequestSchema,
  voidStockReceiptRequestSchema,
} from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { StockReceiptService } from './stock-receipt.service';

/**
 * "Phiếu nhập kho" (Kho Thuốc GĐ2, docs/DECISIONS.md #146) — không gắn `entityIdParam` cho
 * break-glass (cùng lý do `cash_voucher`: dữ liệu vận hành kho, không phải lâm sàng khẩn cấp).
 */
@Controller('inventory/receipts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockReceiptController {
  constructor(private readonly stockReceiptService: StockReceiptService) {}

  @Get()
  @RequirePermission('stock_receipt', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockReceiptsQuerySchema.parse(query);
    const { tenantId } = req.user!;
    return this.stockReceiptService.list(tenantId, dto);
  }

  @Get(':id')
  @RequirePermission('stock_receipt', 'read')
  @AuditView('stock_receipt')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = req.user!;
    return this.stockReceiptService.getById(tenantId, id);
  }

  @Post()
  @RequirePermission('stock_receipt', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockReceiptService.create(tenantId, userId, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('stock_receipt', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockReceiptService.update(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('stock_receipt', 'approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveStockReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockReceiptService.approve(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('stock_receipt', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockReceiptService.reject(tenantId, userId, id, dto, extractRequestMeta(req));
  }

  @Post(':id/void')
  @RequirePermission('stock_receipt', 'approve')
  @HttpCode(200)
  async voidReceipt(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = voidStockReceiptRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockReceiptService.voidReceipt(tenantId, userId, id, dto, extractRequestMeta(req));
  }
}
