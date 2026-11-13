import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  cancelPurchaseOrderRequestSchema,
  closePurchaseOrderRequestSchema,
  createPurchaseOrderRequestSchema,
  listPurchaseOrdersQuerySchema,
  rejectPurchaseOrderRequestSchema,
  updatePurchaseOrderRequestSchema,
  versionedPurchaseOrderRequestSchema,
} from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { AuditView } from '../../common/audit-view.decorator';
import { AuditViewInterceptor } from '../../common/audit-view.interceptor';
import { extractRequestMeta } from '../../common/request-meta';
import { PurchaseOrderExportService } from './purchase-order-export.service';
import { PurchaseOrderService } from './purchase-order.service';

/**
 * "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2) — không gắn `entityIdParam` cho break-glass (dữ liệu vận hành kho, không phải lâm sàng khẩn cấp).
 * Quyền: `create` lập/sửa/gửi duyệt/gửi NCC/đóng/huỷ, `approve` duyệt/từ chối; Service tự kiểm chi nhánh + phía duyệt. Route tĩnh đặt TRƯỚC `:id`.
 */
@Controller('inventory/purchase-orders')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PurchaseOrderController {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly exportService: PurchaseOrderExportService,
  ) {}

  @Get()
  @RequirePermission('purchase_order', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const dto = listPurchaseOrdersQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.list(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto);
  }

  /** Chấm số "Cần tôi duyệt" trên menu. */
  @Get('pending-counts')
  @RequirePermission('purchase_order', 'read')
  async pendingCounts(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.purchaseOrderService.getPendingCounts(tenantId, requireBranchId(req.user!));
  }

  /** Cờ cấu hình + chi nhánh hiện tại để web ẩn/hiện nút. */
  @Get('options')
  @RequirePermission('purchase_order', 'read')
  async options(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.purchaseOrderService.getOptions(tenantId, requireBranchId(req.user!));
  }

  @Get('export')
  @RequirePermission('purchase_order', 'read')
  async exportList(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const dto = listPurchaseOrdersQuerySchema.parse(query);
    const { userId, tenantId } = req.user!;
    const { items } = await this.purchaseOrderService.listAllForExport(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto);
    const multiBranch = new Set(items.map((i) => i.branchId)).size > 1;
    const buffer = await this.exportService.buildListExcel(dto.view, items, multiBranch);
    await this.purchaseOrderService.recordExportAudit(tenantId, userId, dto, extractRequestMeta(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="don-dat-hang-ncc-${dto.view === 'mine' ? 'cua-chi-nhanh' : 'can-duyet'}.xlsx"`);
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermission('purchase_order', 'read')
  @AuditView('purchase_order')
  @UseInterceptors(AuditViewInterceptor)
  async get(@Param('id') id: string, @Req() req: Request) {
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.getById(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id);
  }

  @Post()
  @RequirePermission('purchase_order', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.create(tenantId, requireBranchId(req.user!), userId, req.dataScope!, dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('purchase_order', 'create')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updatePurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.update(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/submit')
  @RequirePermission('purchase_order', 'create')
  @HttpCode(200)
  async submit(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = versionedPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.submit(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/approve')
  @RequirePermission('purchase_order', 'approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = versionedPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.approve(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/reject')
  @RequirePermission('purchase_order', 'approve')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = rejectPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.reject(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/order')
  @RequirePermission('purchase_order', 'create')
  @HttpCode(200)
  async order(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = versionedPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.order(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/close')
  @RequirePermission('purchase_order', 'create')
  @HttpCode(200)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = closePurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.close(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermission('purchase_order', 'create')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = cancelPurchaseOrderRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.purchaseOrderService.cancel(tenantId, requireBranchId(req.user!), userId, req.dataScope!, id, dto, extractRequestMeta(req));
  }
}
