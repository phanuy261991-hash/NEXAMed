import { Injectable } from '@nestjs/common';
import type { SignaturePort, SignatureResult, SignatureTarget } from '@nexamed/core';

/**
 * Adapter no-op cho v1 — chữ ký logic: trả `signedAt`/`signedBy`, `signaturePayload: null`. Xem
 * .claude/docs/security-audit.md mục "Chữ ký số (chưa triển khai ở v1)". Không tự ý tích hợp CA.
 */
@Injectable()
export class NoopSignatureAdapter implements SignaturePort {
  async sign(_tenantId: string, actorId: string, _target: SignatureTarget): Promise<SignatureResult> {
    return { signedAt: new Date(), signedBy: actorId, signaturePayload: null };
  }
}
