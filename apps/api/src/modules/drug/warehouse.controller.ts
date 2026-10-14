import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createWarehouseRequestSchema, listWarehousesQuerySchema, updateWarehouseRequestSchema } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { extractRequestMeta } from '../../common/request-meta';
import { WarehouseService } from './warehouse.service';

/** Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — dùng chung `drug.read`/
 * `drug.create`/`drug.update` (tách từ `drug.manage` gộp cũ, #156; cùng trang "Danh mục Thuốc &
 * Vật tư" ở web). Đợt 2 chi nhánh (#233): kho thuộc chi nhánh — mặc định chỉ liệt kê kho của chi nhánh đang
 * làm, `?allBranches=true` liệt kê mọi chi nhánh tài khoản được gán. */
@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  @RequirePermission('drug', 'read')
  async list(@Query() query: unknown, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    const { allBranches } = listWarehousesQuerySchema.parse(query);
    return this.warehouseService.listWarehouses(tenantId, userId, requireBranchId(req.user!), allBranches);
  }

  /** Ô chọn KHO NHẬN ở form điều chuyển (#233): mọi kho hoạt động của công ty kể cả chi nhánh khác, chỉ trường tối thiểu (không tồn/giá). Dùng quyền tạo phiếu điều chuyển, không cần quyền danh mục kho. Đặt TRƯỚC `:id`. */
  @Get('transfer-destinations')
  @RequirePermission('stock_transfer', 'create')
  async transferDestinations(@Req() req: Request) {
    return this.warehouseService.listTransferDestinations(req.user!.tenantId);
  }

  /** Một bản ghi theo id — nhẹ hơn tải cả danh sách; web dùng để phát hiện bản ghi bị người khác sửa lúc form Sửa đang mở (`useEditedRecordGuard`). 404 nếu không có/khác tenant/khác chi nhánh được gán. */
  @Get(':id')
  @RequirePermission('drug', 'read')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { tenantId, userId } = req.user!;
    return this.warehouseService.getWarehouse(tenantId, userId, requireBranchId(req.user!), id);
  }

  @Post()
  @RequirePermission('drug', 'create')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    const dto = createWarehouseRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.warehouseService.createWarehouse(tenantId, userId, requireBranchId(req.user!), dto, extractRequestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('drug', 'update')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const dto = updateWarehouseRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    return this.warehouseService.updateWarehouse(tenantId, userId, requireBranchId(req.user!), id, dto, extractRequestMeta(req));
  }
}
