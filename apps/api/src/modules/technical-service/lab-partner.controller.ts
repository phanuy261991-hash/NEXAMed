import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { LabPartnerSummaryResponse } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { TechnicalServiceRepository } from './technical-service.repository';

/**
 * "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — danh mục đối tác là các nhà cung cấp có cờ `is_lab_partner` (tạo/sửa qua `/suppliers`); route này chỉ trả số dịch vụ có giá trả của từng đối tác
 * cho cột "Dịch vụ" ở danh mục. Dữ liệu CHUNG cả công ty (không theo chi nhánh). Dùng quyền xem dịch vụ kỹ thuật.
 */
@Controller('lab-partners')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LabPartnerController {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: TechnicalServiceRepository,
  ) {}

  @Get('summary')
  @RequirePermission('technical_service', 'read')
  async summary(@Req() req: Request): Promise<LabPartnerSummaryResponse> {
    const { tenantId } = req.user!;
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({ items: await this.repository.countServicesBySupplier(tx, tenantId) }));
  }
}
