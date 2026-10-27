import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { findAllPermissionsForUser } from '../../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { EncryptionKeyService } from './encryption-key.service';

/**
 * `GET /api/v1/encryption-key/status` — khoá mã hoá có khớp dữ liệu không (docs/DECISIONS.md #262). Mọi tài khoản đã đăng nhập hỏi được `state` (giao diện cần biết để hiện "không đọc được" thay vì lỗi);
 * MÃ KIỂM khoá chỉ trả cho người quản trị (`clinic_config.update` hoặc `system_backup.read`) — ai khác nhận `null`. Không tiết lộ khoá, chỉ băm cụt 32 bit.
 */
@Controller('encryption-key')
@UseGuards(JwtAuthGuard)
export class EncryptionKeyController {
  constructor(
    private readonly service: EncryptionKeyService,
    private readonly unitOfWork: UnitOfWorkService,
  ) {}

  @Get('status')
  async status(@Req() req: Request) {
    const { tenantId, userId } = req.user!;
    const status = await this.service.getStatus(tenantId);
    const permissions = await this.unitOfWork.runInTenantScope(tenantId, (tx) => findAllPermissionsForUser(tx, tenantId, userId));
    const isAdmin = 'clinic_config.update' in permissions || 'system_backup.read' in permissions;
    return {
      state: status.state,
      actualFingerprint: isAdmin ? status.actualFingerprint : null,
      expectedFingerprint: isAdmin ? status.expectedFingerprint : null,
      canSeeDetails: isAdmin,
    };
  }
}
