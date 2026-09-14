import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PermissionGuard } from '../../common/permission.guard';
import { RequirePermission } from '../../common/require-permission.decorator';
import { BackupStatusService } from './backup-status.service';

/**
 * `GET /backup-status` (S6-01, ADM-04) — chỉ `clinic_admin` xem được (tái dùng `clinic_config.read`
 * có sẵn, không thêm permission mới — đúng đối tượng cần biết "sao lưu có đang chạy đúng
 * không"). FE hiện banner toàn cục khi `needsAttention: true`, xem `docs/DECISIONS.md`.
 */
@Controller('backup-status')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BackupStatusController {
  constructor(private readonly backupStatusService: BackupStatusService) {}

  @Get()
  @RequirePermission('clinic_config', 'read')
  async get() {
    return this.backupStatusService.getStatus();
  }
}
