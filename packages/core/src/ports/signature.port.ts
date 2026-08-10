/**
 * Ký hồ sơ khám / đơn thuốc — xem .claude/docs/security-audit.md mục "Chữ ký số (chưa triển
 * khai ở v1)" và .claude/docs/clinical-workflow.md. v1 chỉ có chữ ký logic: adapter no-op trả
 * `signaturePayload: null`, service tự ghi `signedAt`/`signedBy` vào entity từ kết quả trả về.
 * Không tự ý tích hợp CA hay chọn chuẩn ký (PKCS#7, XAdES) — chờ chốt với nghiệp vụ.
 */
export interface SignatureTarget {
  entityType: string;
  entityId: string;
}

export interface SignatureResult {
  signedAt: Date;
  signedBy: string;
  signaturePayload: Uint8Array | null;
}

export interface SignaturePort {
  sign(tenantId: string, actorId: string, target: SignatureTarget): Promise<SignatureResult>;
}

export const SIGNATURE_PORT = Symbol('SIGNATURE_PORT');
