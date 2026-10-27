import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionKeyMismatchError, SYSTEM_ACTOR_ID } from '@nexamed/core';
import { keyFingerprint } from '../../infrastructure/crypto/key-fingerprint';
import { tryDecryptPii } from '../../infrastructure/crypto/pii-encryption';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { EncryptionKeyRepository } from './encryption-key.repository';

export type EncryptionKeyState = 'ok' | 'mismatch';

export interface EncryptionKeyStatus {
  state: EncryptionKeyState;
  /** Mã kiểm của khoá ĐANG CHẠY (`.env` hiện tại). */
  actualFingerprint: string;
  /** Mã kiểm của khoá đã mã hoá dữ liệu; `null` khi không biết (hệ thống cài trước bản này và khoá đã sai ngay từ đầu). */
  expectedFingerprint: string | null;
}

const CACHE_TTL_MS = 60_000;

/**
 * Kiểm tra khoá mã hoá hệ thống có khớp dữ liệu đã lưu không (docs/DECISIONS.md #262). Mỗi công ty có một mã kiểm khoá được ghi LẦN ĐẦU (`tenant_setting.encryption_key_fingerprint`):
 * - Chưa có mã đã ghi: nếu đã có dữ liệu mã hoá thì thử giải mã một mẫu — được thì khoá đang chạy đúng (ghi mã), không được thì khoá SAI (không biết mã gốc); chưa có dữ liệu mã hoá thì ghi mã hiện tại.
 * - Đã có mã: khớp khoá đang chạy thì ổn, khác thì `mismatch`.
 * Kết quả giữ 60 giây. `mismatch` → từ chối GHI trường mã hoá (`assertWritable`), phần ĐỌC không bị chặn.
 * Sửa `.env` rồi KHỞI ĐỘNG LẠI là cách khắc phục (khoá chỉ đọc lúc khởi động).
 */
@Injectable()
export class EncryptionKeyService {
  private readonly logger = new Logger(EncryptionKeyService.name);
  private readonly cache = new Map<string, { at: number; status: EncryptionKeyStatus }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: EncryptionKeyRepository,
  ) {}

  private key(): string {
    return this.configService.getOrThrow<string>('ENCRYPTION_KEY');
  }

  async getStatus(tenantId: string): Promise<EncryptionKeyStatus> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.status;
    const status = await this.compute(tenantId);
    this.cache.set(tenantId, { at: Date.now(), status });
    if (status.state === 'mismatch') {
      // Không ghi PII: chỉ mã kiểm (băm cụt 32 bit), không phải khoá.
      this.logger.error(`Khoá mã hoá KHÔNG khớp dữ liệu của công ty ${tenantId}: đang chạy ${status.actualFingerprint}, dữ liệu mã hoá bằng ${status.expectedFingerprint ?? 'khoá khác (không rõ)'}.`);
    }
    return status;
  }

  /** Ném `EncryptionKeyMismatchError` nếu khoá không khớp — gọi TRƯỚC khi ghi bất kỳ trường mã hoá nào. */
  async assertWritable(tenantId: string): Promise<void> {
    if ((await this.getStatus(tenantId)).state === 'mismatch') throw new EncryptionKeyMismatchError();
  }

  /** Xoá bộ nhớ đệm (dùng trong test). */
  clearCache(): void {
    this.cache.clear();
  }

  private async compute(tenantId: string): Promise<EncryptionKeyStatus> {
    const key = this.key();
    const actualFingerprint = keyFingerprint(key);
    const { stored, sample } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({
      stored: await this.repository.getStoredFingerprint(tx, tenantId),
      sample: await this.repository.findSampleCipher(tx, tenantId),
    }));

    if (stored !== null) {
      return { state: stored === actualFingerprint ? 'ok' : 'mismatch', actualFingerprint, expectedFingerprint: stored };
    }
    if (sample !== null && tryDecryptPii(sample, key) === null) {
      return { state: 'mismatch', actualFingerprint, expectedFingerprint: null };
    }
    // Khoá đúng (giải mã được mẫu) hoặc chưa có dữ liệu mã hoá nào: ghi mã kiểm để lần sau biết khoá gốc.
    await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.saveFingerprint(tx, tenantId, SYSTEM_ACTOR_ID, actualFingerprint));
    return { state: 'ok', actualFingerprint, expectedFingerprint: actualFingerprint };
  }
}
