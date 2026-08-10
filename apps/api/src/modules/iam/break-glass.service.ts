import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { InvalidCredentialsError, NOTIFICATION_PORT, computeExpiresAt, type NotificationPort } from '@nexamed/core';
import type { BreakGlassRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BreakGlassRepository } from './break-glass.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from './auth.service';

export interface RequestContext {
  tenantId: string;
  actorId: string;
}

export interface BreakGlassRequestResult {
  expiresAt: Date;
}

export interface BreakGlassConsumeResult {
  granted: boolean;
  expiresAt?: Date;
}

type RequestOutcome = { kind: 'success'; expiresAt: Date } | { kind: 'invalid_credentials' };

/**
 * Xem .claude/docs/security-audit.md mục Break-glass. `request()` là endpoint thật
 * (`POST /break-glass`); `tryConsume()` là primitive sẵn sàng cho guard `data_scope` thật ở
 * S2 gọi khi một request bị chặn bởi scope `personal`/`department` — tự mở transaction riêng
 * (không nhận `tx` từ ngoài) vì guard chạy trước khi service nghiệp vụ mở transaction của nó.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountAuthRepository: UserAccountAuthRepository,
    private readonly breakGlassRepository: BreakGlassRepository,
    @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
  ) {}

  async request(ctx: RequestContext, dto: BreakGlassRequest, meta: RequestMeta): Promise<BreakGlassRequestResult> {
    const outcome = await this.unitOfWork.runInTenantScope<RequestOutcome>(ctx.tenantId, async (tx) => {
      const user = await this.userAccountAuthRepository.findById(tx, ctx.tenantId, ctx.actorId);
      if (!user) {
        return { kind: 'invalid_credentials' };
      }

      const passwordOk = await argon2.verify(user.passwordHash, dto.password);
      if (!passwordOk) {
        return { kind: 'invalid_credentials' };
      }

      const durationMinutes = await this.breakGlassRepository.getDurationMinutes(tx, ctx.tenantId);
      const occurredAt = new Date();
      const expiresAt = computeExpiresAt(occurredAt, durationMinutes);

      await this.breakGlassRepository.create(tx, ctx.tenantId, {
        actorId: ctx.actorId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        reason: dto.reason,
        occurredAt,
        expiresAt,
      });

      await writeAuditLog(tx, ctx.tenantId, {
        actorId: ctx.actorId,
        action: 'break_glass.request',
        entityType: dto.entityType,
        entityId: dto.entityId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { kind: 'success', expiresAt };
    });

    if (outcome.kind === 'invalid_credentials') {
      throw new InvalidCredentialsError();
    }

    // Gọi ngoài transaction: notify không phải một phần của "đã tạo phiên hay chưa" — no-op ở
    // v1 nên không lỗi, nhưng khi có adapter thật (S2+) một lần gửi thất bại không nên rollback
    // cả yêu cầu phá kính đã hợp lệ.
    await this.notificationPort.send({
      tenantId: ctx.tenantId,
      type: 'break_glass.requested',
      message: 'Có yêu cầu phá kính cần xem xét.',
      metadata: { actorId: ctx.actorId, entityType: dto.entityType, entityId: dto.entityId },
    });

    return { expiresAt: outcome.expiresAt };
  }

  async tryConsume(
    tenantId: string,
    actorId: string,
    entityType: string,
    entityId: string,
    meta: RequestMeta,
  ): Promise<BreakGlassConsumeResult> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const session = await this.breakGlassRepository.findActive(tx, tenantId, actorId, entityType, entityId, new Date());
      if (!session) {
        return { granted: false };
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'break_glass.access',
        entityType,
        entityId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { granted: true, expiresAt: session.expiresAt };
    });
  }
}
