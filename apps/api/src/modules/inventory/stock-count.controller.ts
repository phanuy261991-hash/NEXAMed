import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { approveStockCountRequestSchema, createStockCountRequestSchema, listStockCountsQuerySchema, rejectStockCountRequestSchema, updateStockCountRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { StockCountService } from './stock-count.service';

/**
 * "Phiếu kiểm kê" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — không gắn `entityIdParam` cho
 * break-glass, cùng lý do `stock_receipt` (dữ liệu vận hành kho, không phải lâm sàng khẩn cấp).
 *
 * Phân quyền theo Khoa/Phòng (mục 0 kế hoạch kỹ thuật #170) — mọi handler đọc `req.dataScope!`
 * (đã được `PermissionGuard` gán sẵn) và truyền xuống Service, đúng khuôn `encounter.controller.ts`
 * ("Nhận ca")/`appointment.controller.ts`. Mặc định 5 vai trò hệ thống vẫn `global` (không đổi hành
 * vi hiện có) — ranh giới Khoa chỉ có tác dụng khi `clinic_admin` chủ động chọn scope `department`
 * cho 1 vai trò tuỳ biến ở "Vai trò & Phân quyền".
 */
@Controller('inventory/counts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class StockCountController {
  constructor(private readonly stockCountService: StockCountService) {}

  @Get()
  @RequirePermission('stock_count', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listStockCountsQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.stockCountService.list(tenantId, userId, req.dataScope!, dto);
  }

  @Get(':id')
  @RequirePermission('stock_count', 'read')
  @AuditView('stock_count')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.stockCountService.getById(tenantId, userId, req.dataScope!, id);
  }

  @Post()
  @RequirePermission('stock_count', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createStockCountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockCountService.create(tenantId, userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('stock_count', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateStockCountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockCountService.update(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('stock_count', 'approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = approveStockCountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockCountService.approve(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('stock_count', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectStockCountRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.stockCountService.reject(tenantId, userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
