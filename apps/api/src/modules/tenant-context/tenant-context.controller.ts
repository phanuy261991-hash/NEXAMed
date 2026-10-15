import { Controller, Get, HttpCode, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TenantNotFoundError } from '@nexamed/core';
import type { TenantContextResponse } from '@nexamed/shared';
import { SaasOnlyGuard } from '../../common/saas-only.guard';
import { TenantHostService } from './tenant-host.service';

/**
 * `GET /public/tenant-context` (docs/DECISIONS.md #237) — CÔNG KHAI: web ở chế độ SaaS hỏi "địa chỉ này là công ty nào" trước khi hiện màn đăng nhập (không có `tenantId` trong `config.json`).
 * KHÔNG giới hạn tần suất theo IP: mỗi lần mở/tải lại trang đều gọi, nhiều nhân viên một phòng khám chung một IP; tra cứu rẻ (đệm 5 giây) và chỉ lộ đúng thứ màn đăng nhập hiển thị. Chỉ trả tên + mã + trạng thái tạm ngưng của chính công ty ứng với tên miền phụ (đúng thứ màn đăng nhập hiển thị), không liệt kê công ty nào khác. Chế độ một công ty: 404.
 */
@Controller('public')
@UseGuards(SaasOnlyGuard)
export class TenantContextController {
  constructor(private readonly hostService: TenantHostService) {}

  @Get('tenant-context')
  @HttpCode(200)
  async tenantContext(@Req() req: Request): Promise<TenantContextResponse> {
    const host = this.hostService.resolveRequestHost(req);
    if (host.kind === 'platform') return { kind: 'platform' };
    const tenant = await this.hostService.resolveTenant(req);
    if (!tenant) throw new TenantNotFoundError();
    return { kind: 'tenant', tenantId: tenant.tenantId, name: tenant.name, code: tenant.code, suspended: tenant.suspended };
  }
}
