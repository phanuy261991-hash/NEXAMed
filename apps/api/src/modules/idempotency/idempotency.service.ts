import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  IDEMPOTENCY_MAX_RESPONSE_BYTES,
  IDEMPOTENCY_POLL_INTERVAL_MS,
  IDEMPOTENCY_STALE_LOCK_MS,
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_WAIT_MS,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
  IdempotencyReplayUnavailableError,
} from '@nexamed/core';
import { decryptPii, encryptPii } from '../../infrastructure/crypto/pii-encryption';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { IdempotencyKeyRepository, type IdempotencyKeyRow } from './idempotency-key.repository';

export interface AcquireInput {
  requestKey: string;
  requestHash: string;
  method: string;
  path: string;
}

export type AcquireOutcome = { kind: 'claimed'; id: string } | { kind: 'replay'; value: unknown };

type BeginOutcome = AcquireOutcome | { kind: 'wait' };

/**
 * Khoá chống ghi trùng khi mạng đứt giữa chừng (docs/DECISIONS.md #257). `acquire` giữ chỗ khoá TRƯỚC khi chạy nghiệp vụ (giao dịch ngắn, đóng xong trước khi
 * nghiệp vụ mở giao dịch riêng của nó — KHÔNG lồng, tránh cạn bể kết nối), `complete`/`fail` ghi kết quả SAU khi nghiệp vụ xong.
 *
 * Mọi nhánh quyết định ở `begin` (một giao dịch):
 *  - giữ chỗ được → `claimed` (chạy nghiệp vụ);
 *  - khoá đã có, đã xong, cùng vân tay → `replay` (trả đúng kết quả cũ; không có kết quả lưu → `IdempotencyReplayUnavailableError`); khác vân tay → `IdempotencyKeyReusedError`;
 *  - khoá đã có, đang xử lý, chưa treo → `wait` (người gọi chờ rồi hỏi lại); khác vân tay → `IdempotencyKeyReusedError`;
 *  - khoá đã có nhưng lỗi nghiệp vụ / treo quá lâu / hết hạn → tiếp quản cho yêu cầu này (khoá lạc quan, một bên thắng).
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: IdempotencyKeyRepository,
    private readonly configService: ConfigService,
  ) {}

  async acquire(tenantId: string, userId: string, input: AcquireInput): Promise<AcquireOutcome> {
    const deadline = Date.now() + IDEMPOTENCY_WAIT_MS;
    for (;;) {
      const outcome = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.begin(tx, tenantId, userId, input));
      if (outcome.kind !== 'wait') return outcome;
      if (Date.now() >= deadline) throw new IdempotencyInProgressError();
      await sleep(IDEMPOTENCY_POLL_INTERVAL_MS);
    }
  }

  /** Ghi phản hồi thành công. Lỗi ở đây KHÔNG được làm hỏng phản hồi đã có (nghiệp vụ đã ghi xong) — chỉ log; dòng sẽ được tiếp quản sau khi "treo". */
  async complete(tenantId: string, userId: string, id: string, data: unknown): Promise<void> {
    try {
      const encrypted = this.encodeResponse(data);
      await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.complete(tx, tenantId, id, userId, encrypted));
    } catch (error) {
      this.logger.error(`Không ghi được kết quả khoá chống ghi trùng ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Nhả khoá khi nghiệp vụ lỗi hoặc phản hồi không lưu được dạng JSON (xuất tệp...). */
  async fail(tenantId: string, userId: string, id: string): Promise<void> {
    try {
      await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.fail(tx, tenantId, id, userId));
    } catch (error) {
      this.logger.error(`Không nhả được khoá chống ghi trùng ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async begin(tx: Prisma.TransactionClient, tenantId: string, userId: string, input: AcquireInput): Promise<BeginOutcome> {
    const now = Date.now();
    const expiresAt = new Date(now + IDEMPOTENCY_TTL_MS);

    const claimed = await this.repository.claim(tx, tenantId, userId, { ...input, expiresAt });
    const row = await this.repository.find(tx, tenantId, userId, input.requestKey);
    if (!row) return { kind: 'wait' }; // không thể xảy ra (vừa giữ chỗ/đã có), phòng thủ: hỏi lại.
    if (claimed) return { kind: 'claimed', id: row.id };

    if (this.isReusable(row, now)) {
      const won = await this.repository.takeOver(tx, tenantId, row, { requestHash: input.requestHash, method: input.method, path: input.path, actorId: userId, expiresAt });
      return won ? { kind: 'claimed', id: row.id } : { kind: 'wait' };
    }

    if (row.requestHash !== input.requestHash) throw new IdempotencyKeyReusedError();
    if (row.status === 'IN_PROGRESS') return { kind: 'wait' };

    // COMPLETED, cùng vân tay → trả lại đúng kết quả đã lưu.
    if (!row.responseBodyEnc) throw new IdempotencyReplayUnavailableError();
    return { kind: 'replay', value: this.decodeResponse(Buffer.from(row.responseBodyEnc)) };
  }

  /** Dòng cho phép yêu cầu mới tiếp quản: lỗi nghiệp vụ (đã nhả), treo quá lâu, hoặc đã hết hạn. */
  private isReusable(row: IdempotencyKeyRow, now: number): boolean {
    if (row.status === 'FAILED') return true;
    if (row.expiresAt.getTime() < now) return true;
    return row.status === 'IN_PROGRESS' && now - row.lockedAt.getTime() > IDEMPOTENCY_STALE_LOCK_MS;
  }

  /** `null` khi phản hồi quá lớn: vẫn đánh dấu hoàn tất (chống ghi trùng) nhưng không replay được nguyên văn. Ném lỗi nếu không tuần tự hoá được JSON. */
  private encodeResponse(data: unknown): Buffer | null {
    const json = JSON.stringify({ v: data });
    if (Buffer.byteLength(json, 'utf8') > IDEMPOTENCY_MAX_RESPONSE_BYTES) return null;
    return encryptPii(json, this.encryptionKey());
  }

  private decodeResponse(payload: Buffer): unknown {
    return (JSON.parse(decryptPii(payload, this.encryptionKey())) as { v?: unknown }).v;
  }

  private encryptionKey(): string {
    return this.configService.getOrThrow<string>('ENCRYPTION_KEY');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
