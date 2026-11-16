import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { PatientDocumentUsageService } from './patient-document-usage.service';

/**
 * `GET /patient-documents/usage` — dung lượng tệp gắn bệnh nhân của cả công ty, hiện ở Cấu hình chung (docs/DECISIONS.md #299 bổ sung 4). Cùng quyền với trang Cấu hình chung
 * (`clinic_config.read`). Không gắn công tắc "Dùng Hình ảnh & Tài liệu": tệp vẫn nằm trên đĩa kể cả khi tab đang tắt, và quản trị cần thấy số đó để lo ổ sao lưu.
 */
@Controller('patient-documents')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PatientDocumentUsageController {
  constructor(private readonly service: PatientDocumentUsageService) {}

  @Get('usage')
  @RequirePermission('clinic_config', 'read')
  async usage(@Req() req: Request) {
    return this.service.getUsage(req.user!.tenantId);
  }
}
