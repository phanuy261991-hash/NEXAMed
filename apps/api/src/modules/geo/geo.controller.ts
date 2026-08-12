import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { listWardsQuerySchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { GeoService } from './geo.service';

/**
 * Danh mục hành chính Tỉnh/Phường-Xã toàn hệ thống, read-only (docs/DECISIONS.md #038). Dùng lại
 * quyền `patient.read` thay vì thêm permission mới — v1 chỉ có `patient.address_json` cần danh mục
 * này để điền form, cùng đối tượng vai trò (`receptionist`/`nurse`/`doctor`/`clinic_admin`) như
 * ma trận mặc định của `patient.read`; tránh lặp lại vấn đề "chưa có cơ chế backfill role_permission
 * cho tenant cũ" đã ghi ở docs/CURRENT.md khi thêm permission mới — giống cách `appointment.read`
 * được dùng lại cho `GET /appointments/doctors|schedule-config` (S2-09).
 */
@Controller('geo')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('provinces')
  @RequirePermission('patient', 'read')
  async listProvinces(@Req() req: Request) {
    const { tenantId } = req.user!;
    return this.geoService.listProvinces(tenantId);
  }

  /** `provinceCode` bỏ trống → toàn bộ ward (xem `listWardsQuerySchema` ở packages/shared). */
  @Get('wards')
  @RequirePermission('patient', 'read')
  async listWards(@Query('provinceCode') provinceCode: string | undefined, @Req() req: Request) {
    const { provinceCode: parsedProvinceCode } = listWardsQuerySchema.parse({ provinceCode });
    const { tenantId } = req.user!;
    return this.geoService.listWards(tenantId, parsedProvinceCode);
  }
}
