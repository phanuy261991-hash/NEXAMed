import { Injectable } from '@nestjs/common';
import type { BreakGlassSession, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_BREAK_GLASS_DURATION_MINUTES } from '@nexamed/core';

const BREAK_GLASS_DURATION_SETTING_KEY = 'break_glass_duration_minutes';
const durationMinutesSchema = z.number().int().positive();

export interface CreateBreakGlassSessionInput {
  actorId: string;
  entityType: string;
  entityId: string;
  reason: string;
  occurredAt: Date;
  expiresAt: Date;
}

/**
 * Chỗ DUY NHẤT động vào `break_glass_session` (append-only — không update/xoá, xem
 * .claude/docs/security-audit.md mục Break-glass) và đọc `tenant_setting` key
 * `break_glass_duration_minutes`.
 */
@Injectable()
export class BreakGlassRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, input: CreateBreakGlassSessionInput): Promise<BreakGlassSession> {
    return tx.breakGlassSession.create({
      data: {
        tenantId,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason,
        occurredAt: input.occurredAt,
        expiresAt: input.expiresAt,
      },
    });
  }

  /** Phiên còn hiệu lực gần nhất cho đúng (actor, entity) — có thể có nhiều phiên chồng nhau, lấy phiên hết hạn muộn nhất. */
  findActive(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    entityType: string,
    entityId: string,
    now: Date,
  ): Promise<BreakGlassSession | null> {
    return tx.breakGlassSession.findFirst({
      where: { tenantId, actorId, entityType, entityId, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    });
  }

  async getDurationMinutes(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const setting = await tx.tenantSetting.findFirst({
      where: { tenantId, key: BREAK_GLASS_DURATION_SETTING_KEY },
    });
    if (!setting) {
      return DEFAULT_BREAK_GLASS_DURATION_MINUTES;
    }

    const parsed = durationMinutesSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_BREAK_GLASS_DURATION_MINUTES;
  }
}
