import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_PRESCRIPTION_INTEROP_SETTINGS, prescriptionInteropSettingsSchema, type PrescriptionInteropSettings } from '@nexamed/shared';

const SETTINGS_KEY = 'prescription_interop';

/** Mã + trạng thái đã lưu — KHÔNG bao giờ chứa mật khẩu hay token ở dạng đọc được. */
export interface StoredCredentialSummary {
  code: string;
  version: number;
  /** Giờ nhận token hiện có (cơ sở) — dùng để tính trạng thái/hạn. `null` = chưa có token. */
  tokenIssuedAt: Date | null;
}

/** Bản đầy đủ phục vụ gọi cổng — CÓ dữ liệu mã hoá (mật khẩu, token). Chỉ dùng trong dịch vụ, không đi ra API. */
export interface StoredFacilityCredentialSecret extends StoredCredentialSummary {
  passwordEnc: Buffer;
  tokenEnc: Buffer | null;
}

export interface StoredDoctorCredentialSecret {
  code: string;
  version: number;
  passwordEnc: Buffer;
}

export interface StoredDoctorFacilityPair {
  id: string;
  addedAt: Date | null;
  tokenEnc: Buffer | null;
  tokenIssuedAt: Date | null;
}

/**
 * Liên thông đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3) — cấu hình (`tenant_setting` key `prescription_interop`), mã/mật khẩu liên thông của cơ sở (theo chi nhánh) và bác sĩ
 * (chung công ty), token đăng nhập cổng và quan hệ (bác sĩ, chi nhánh) "đã thêm vào cơ sở trên cổng". Mật khẩu/token mã hoá do service làm; repository chỉ nhận/ghi `Buffer`.
 * Hàm trả về cho API (`list*`) KHÔNG chứa mật khẩu/token; chỉ các hàm `find*Secret` trả bản mã hoá cho dịch vụ.
 */
@Injectable()
export class PrescriptionInteropRepository {
  async getSettings(tx: Prisma.TransactionClient, tenantId: string): Promise<PrescriptionInteropSettings> {
    const row = await tx.tenantSetting.findFirst({ where: { tenantId, key: SETTINGS_KEY } });
    // Thiếu khoá/không hợp lệ → mặc định (tắt liên thông). `partial().safeParse` để thiếu một trường (cấu hình cũ trước khi thêm trường mới) vẫn đọc được phần còn lại.
    const parsed = prescriptionInteropSettingsSchema.partial().safeParse(row?.valueJson ?? {});
    return { ...DEFAULT_PRESCRIPTION_INTEROP_SETTINGS, ...(parsed.success ? parsed.data : {}) } as PrescriptionInteropSettings;
  }

  upsertSettings(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: PrescriptionInteropSettings) {
    return tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: SETTINGS_KEY } },
      create: { tenantId, key: SETTINGS_KEY, valueJson: value as unknown as Prisma.InputJsonValue, createdBy: actorId, updatedBy: actorId },
      update: { valueJson: value as unknown as Prisma.InputJsonValue, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  // ---- Cơ sở (theo chi nhánh) ----

  /** `branchId → mã/hạn token` của mọi cơ sở đã lưu (chỉ dòng đang hiệu lực). */
  async listFacilityCredentials(tx: Prisma.TransactionClient, tenantId: string): Promise<Map<string, StoredCredentialSummary>> {
    const rows = await tx.interopFacilityCredential.findMany({
      where: { tenantId, deletedAt: null },
      select: { branchId: true, code: true, version: true, tokenIssuedAt: true },
    });
    return new Map(rows.map((r) => [r.branchId, { code: r.code, version: r.version, tokenIssuedAt: r.tokenIssuedAt }]));
  }

  async findFacilityCredential(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<StoredCredentialSummary | null> {
    return tx.interopFacilityCredential.findFirst({ where: { tenantId, branchId, deletedAt: null }, select: { code: true, version: true, tokenIssuedAt: true } });
  }

  /** Bản có dữ liệu mã hoá — CHỈ cho dịch vụ gọi cổng. */
  async findFacilityCredentialSecret(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<StoredFacilityCredentialSecret | null> {
    const row = await tx.interopFacilityCredential.findFirst({
      where: { tenantId, branchId, deletedAt: null },
      select: { code: true, version: true, tokenIssuedAt: true, passwordEnc: true, tokenEnc: true },
    });
    return row ? { code: row.code, version: row.version, tokenIssuedAt: row.tokenIssuedAt, passwordEnc: Buffer.from(row.passwordEnc), tokenEnc: row.tokenEnc ? Buffer.from(row.tokenEnc) : null } : null;
  }

  createFacilityCredential(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string, code: string, passwordEnc: Buffer) {
    return tx.interopFacilityCredential.create({
      data: { tenantId, branchId, code, passwordEnc, createdBy: actorId, updatedBy: actorId },
      select: { id: true },
    });
  }

  /** Sửa mã (và mật khẩu nếu có). `clearToken` = mã hoặc mật khẩu đổi nên token cũ không còn đúng. */
  updateFacilityCredential(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string, code: string, passwordEnc: Buffer | undefined, clearToken: boolean) {
    return tx.interopFacilityCredential.updateMany({
      where: { tenantId, branchId, deletedAt: null },
      data: {
        code,
        ...(passwordEnc ? { passwordEnc } : {}),
        ...(clearToken ? { tokenEnc: null, tokenIssuedAt: null } : {}),
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
  }

  setFacilityToken(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string, tokenEnc: Buffer, issuedAt: Date) {
    return tx.interopFacilityCredential.updateMany({
      where: { tenantId, branchId, deletedAt: null },
      data: { tokenEnc, tokenIssuedAt: issuedAt, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  // ---- Bác sĩ (chung công ty) ----

  async listDoctorCredentials(tx: Prisma.TransactionClient, tenantId: string, userIds: string[]): Promise<Map<string, { code: string; version: number }>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.interopDoctorCredential.findMany({
      where: { tenantId, deletedAt: null, userId: { in: userIds } },
      select: { userId: true, code: true, version: true },
    });
    return new Map(rows.map((r) => [r.userId, { code: r.code, version: r.version }]));
  }

  async findDoctorCredential(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<{ code: string; version: number } | null> {
    return tx.interopDoctorCredential.findFirst({ where: { tenantId, userId, deletedAt: null }, select: { code: true, version: true } });
  }

  async findDoctorCredentialSecret(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<StoredDoctorCredentialSecret | null> {
    const row = await tx.interopDoctorCredential.findFirst({ where: { tenantId, userId, deletedAt: null }, select: { code: true, version: true, passwordEnc: true } });
    return row ? { code: row.code, version: row.version, passwordEnc: Buffer.from(row.passwordEnc) } : null;
  }

  createDoctorCredential(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string, code: string, passwordEnc: Buffer) {
    return tx.interopDoctorCredential.create({
      data: { tenantId, userId, code, passwordEnc, createdBy: actorId, updatedBy: actorId },
      select: { id: true },
    });
  }

  updateDoctorCredential(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string, code: string, passwordEnc: Buffer | undefined) {
    return tx.interopDoctorCredential.updateMany({
      where: { tenantId, userId, deletedAt: null },
      data: { code, ...(passwordEnc ? { passwordEnc } : {}), updatedBy: actorId, version: { increment: 1 } },
    });
  }

  // ---- Cặp (bác sĩ, chi nhánh): đã thêm vào cơ sở trên cổng + token bác sĩ ----

  async listDoctorFacilityPairs(tx: Prisma.TransactionClient, tenantId: string, branchId: string, userIds: string[]): Promise<Map<string, StoredDoctorFacilityPair>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.interopDoctorFacility.findMany({
      where: { tenantId, branchId, deletedAt: null, userId: { in: userIds } },
      select: { id: true, userId: true, addedAt: true, tokenEnc: true, tokenIssuedAt: true },
    });
    return new Map(rows.map((r) => [r.userId, { id: r.id, addedAt: r.addedAt, tokenEnc: r.tokenEnc ? Buffer.from(r.tokenEnc) : null, tokenIssuedAt: r.tokenIssuedAt }]));
  }

  async findDoctorFacilityPair(tx: Prisma.TransactionClient, tenantId: string, userId: string, branchId: string): Promise<StoredDoctorFacilityPair | null> {
    const row = await tx.interopDoctorFacility.findFirst({ where: { tenantId, userId, branchId, deletedAt: null }, select: { id: true, addedAt: true, tokenEnc: true, tokenIssuedAt: true } });
    return row ? { id: row.id, addedAt: row.addedAt, tokenEnc: row.tokenEnc ? Buffer.from(row.tokenEnc) : null, tokenIssuedAt: row.tokenIssuedAt } : null;
  }

  /** Ghi trạng thái cặp (tạo nếu chưa có). `tokenEnc`/`tokenIssuedAt` cùng null hoặc cùng có. */
  async upsertDoctorFacilityPair(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    userId: string,
    branchId: string,
    value: { addedAt: Date | null; tokenEnc: Buffer | null; tokenIssuedAt: Date | null },
  ): Promise<void> {
    const existing = await this.findDoctorFacilityPair(tx, tenantId, userId, branchId);
    if (existing) {
      await tx.interopDoctorFacility.updateMany({
        where: { tenantId, userId, branchId, deletedAt: null },
        data: { addedAt: value.addedAt, tokenEnc: value.tokenEnc, tokenIssuedAt: value.tokenIssuedAt, updatedBy: actorId, version: { increment: 1 } },
      });
    } else {
      await tx.interopDoctorFacility.create({ data: { tenantId, userId, branchId, ...value, createdBy: actorId, updatedBy: actorId } });
    }
  }

  /** Mã/mật khẩu CƠ SỞ đổi → mọi bác sĩ của chi nhánh phải được thêm lại vào cơ sở trên cổng (cơ sở trên cổng có thể là cơ sở khác). */
  resetPairsForBranch(tx: Prisma.TransactionClient, tenantId: string, actorId: string, branchId: string) {
    return tx.interopDoctorFacility.updateMany({
      where: { tenantId, branchId, deletedAt: null },
      data: { addedAt: null, tokenEnc: null, tokenIssuedAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** Mã bác sĩ đổi → bác sĩ trên cổng là người khác: bỏ "đã thêm" và token. Chỉ mật khẩu đổi → chỉ bỏ token (vẫn còn trong cơ sở). */
  resetPairsForDoctor(tx: Prisma.TransactionClient, tenantId: string, actorId: string, userId: string, opts: { codeChanged: boolean }) {
    return tx.interopDoctorFacility.updateMany({
      where: { tenantId, userId, deletedAt: null },
      data: { ...(opts.codeChanged ? { addedAt: null } : {}), tokenEnc: null, tokenIssuedAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
