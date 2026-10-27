import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  ENCRYPTION_KEY_GUARD_PORT,
  InsuranceDisabledError,
  InvalidPhotoError,
  PatientAlreadyMergedError,
  STORAGE_PORT,
  detectInsuranceCardKind,
  getVietnamDateString,
  normalizeInsuranceCardNo,
  pickSuggestedInsuranceCard,
  resolveInsuranceCardValidity,
  sniffImageExtension,
  type ClinicConfigReaderPort,
  type EncryptionKeyGuardPort,
  type StoragePort,
} from '@nexamed/core';
import {
  storedInsuranceSnapshotSchema,
  type CreateInsuranceCardRequest,
  type EncounterInsurance,
  type EncounterInsuranceBadge,
  type InsuranceCard,
  type InsuranceCardPhotoSide,
  type InsuranceCardWarning,
  type ListInsuranceCardsResponse,
  type SaveInsuranceCardResponse,
  type StoredInsuranceSnapshot,
  type UpdateInsuranceCardRequest,
} from '@nexamed/shared';
import { randomUUID } from 'node:crypto';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { insuranceCardHashInput as cardHashInput } from '../../infrastructure/crypto/lookup-hash-inputs';
import { encryptPii, hashForLookup, tryDecryptPii } from '../../infrastructure/crypto/pii-encryption';
import { signFileToken } from '../../infrastructure/storage/signed-url';
import type { RequestMeta } from '../../common/request-meta';
import { PatientRepository } from './patient.repository';
import { PatientInsuranceCardRepository, type InsuranceCardRow, type UpdateInsuranceCardData } from './patient-insurance-card.repository';

/** Ảnh thẻ sống 15 phút — bằng TTL ảnh đại diện, tự làm mới mỗi lần gọi lại API danh sách thẻ. */
const PHOTO_URL_TTL_SECONDS = 15 * 60;
/** Cũng dùng ở controller (giới hạn `FileInterceptor`). */
export const MAX_INSURANCE_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Thẻ BHYT (S2-04, docs/DECISIONS.md #243). Công tắc "Áp dụng BHYT" ĐỌC TRƯỚC khi mở transaction (`ClinicConfigReaderPort`
 * mở transaction riêng — gọi bên trong transaction khác từng làm cạn bể kết nối, xem bài học #242 GĐ1).
 */
@Injectable()
export class PatientInsuranceCardService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly cardRepository: PatientInsuranceCardRepository,
    private readonly patientRepository: PatientRepository,
    private readonly configService: ConfigService,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfig: ClinicConfigReaderPort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ENCRYPTION_KEY_GUARD_PORT) private readonly encryptionKeyGuard: EncryptionKeyGuardPort,
  ) {}

  // ---------------------------------------------------------------- danh sách / gợi ý

  async listForPatient(tenantId: string, patientId: string): Promise<ListInsuranceCardsResponse> {
    const enabled = await this.clinicConfig.getInsuranceEnabled(tenantId);
    const key = this.encryptionKey();
    const today = getVietnamDateString(new Date());
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientExists(tx, tenantId, patientId);
      const rows = await this.cardRepository.listForPatient(tx, tenantId, patientId);
      const items = rows.map((row) => this.toCard(tenantId, row, key, today));
      const suggested = pickSuggestedInsuranceCard(
        rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), validFrom: isoDate(r.validFrom), validTo: isoDate(r.validTo) })),
        today,
      );
      return { enabled, items, suggestedCardId: suggested?.id ?? null };
    });
  }

  // ---------------------------------------------------------------- thêm / sửa / xoá

  async createCard(tenantId: string, actorId: string, patientId: string, dto: CreateInsuranceCardRequest, meta: RequestMeta): Promise<SaveInsuranceCardResponse> {
    await this.assertEnabled(tenantId);
    // Khoá mã hoá không khớp dữ liệu thì không ghi số thẻ mới (#262) — kiểm TRƯỚC khi mở transaction.
    await this.encryptionKeyGuard.assertWritable(tenantId);
    const key = this.encryptionKey();
    const cardNo = this.requireCardNo(dto.cardNo);
    const today = getVietnamDateString(new Date());

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const cardNoHash = hashForLookup(cardHashInput(cardNo), key);
      const duplicate = await this.cardRepository.existsHashForPatient(tx, tenantId, patientId, cardNoHash);
      const row = await this.cardRepository.create(tx, tenantId, patientId, actorId, {
        cardNoEnc: encryptPii(cardNo, key),
        cardNoHash,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        facilityCode: dto.facilityCode ?? null,
        facilityName: dto.facilityName ?? null,
        benefitRate: dto.benefitRate ?? null,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'insurance_card.created',
        entityType: 'insurance_card',
        entityId: row.id,
        // KHÔNG ghi số thẻ vào nhật ký — chỉ id bệnh nhân và kiểu thẻ.
        afterJson: { patientId, kind: detectInsuranceCardKind(cardNo) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { card: this.toCard(tenantId, row, key, today), warnings: this.warnings(cardNo, duplicate) };
    });
  }

  async updateCard(
    tenantId: string,
    actorId: string,
    patientId: string,
    cardId: string,
    dto: UpdateInsuranceCardRequest,
    meta: RequestMeta,
  ): Promise<SaveInsuranceCardResponse> {
    await this.assertEnabled(tenantId);
    if (dto.cardNo !== undefined) await this.encryptionKeyGuard.assertWritable(tenantId);
    const key = this.encryptionKey();
    const cardNo = dto.cardNo !== undefined ? this.requireCardNo(dto.cardNo) : undefined;
    const today = getVietnamDateString(new Date());

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const existing = await this.cardRepository.findById(tx, tenantId, patientId, cardId);
      if (!existing) throw new NotFoundException();

      const patch: UpdateInsuranceCardData = {};
      let duplicate = false;
      if (cardNo !== undefined) {
        patch.cardNoEnc = encryptPii(cardNo, key);
        patch.cardNoHash = hashForLookup(cardHashInput(cardNo), key);
        duplicate = await this.cardRepository.existsHashForPatient(tx, tenantId, patientId, patch.cardNoHash, cardId);
      }
      if (dto.validFrom !== undefined) patch.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
      if (dto.validTo !== undefined) patch.validTo = dto.validTo ? new Date(dto.validTo) : null;
      if (dto.facilityCode !== undefined) patch.facilityCode = dto.facilityCode ?? null;
      if (dto.facilityName !== undefined) patch.facilityName = dto.facilityName ?? null;
      if (dto.benefitRate !== undefined) patch.benefitRate = dto.benefitRate ?? null;

      // Kiểm tra khoảng ngày SAU khi trộn với giá trị hiện có (client chỉ gửi trường đổi).
      const nextFrom = patch.validFrom !== undefined ? patch.validFrom : existing.validFrom;
      const nextTo = patch.validTo !== undefined ? patch.validTo : existing.validTo;
      if (nextFrom && nextTo && nextTo < nextFrom) {
        throw new BadRequestException('Hạn thẻ phải sau hoặc bằng ngày bắt đầu hiệu lực.');
      }

      const count = await this.cardRepository.updateIfVersionMatches(tx, tenantId, patientId, cardId, dto.version, actorId, patch);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'insurance_card.updated',
        entityType: 'insurance_card',
        entityId: cardId,
        afterJson: { patientId, changedFields: Object.keys(patch).filter((k) => k !== 'cardNoEnc' && k !== 'cardNoHash').concat(cardNo !== undefined ? ['cardNo'] : []) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.cardRepository.findById(tx, tenantId, patientId, cardId);
      if (!updated) throw new NotFoundException();
      const effectiveNo = cardNo ?? tryDecryptPii(Buffer.from(updated.cardNoEnc), key) ?? '';
      return { card: this.toCard(tenantId, updated, key, today), warnings: this.warnings(effectiveNo, duplicate) };
    });
  }

  async removeCard(tenantId: string, actorId: string, patientId: string, cardId: string, expectedVersion: number, meta: RequestMeta): Promise<void> {
    await this.assertEnabled(tenantId);
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const existing = await this.cardRepository.findById(tx, tenantId, patientId, cardId);
      if (!existing) throw new NotFoundException();
      const count = await this.cardRepository.softDeleteIfVersionMatches(tx, tenantId, patientId, cardId, expectedVersion, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'insurance_card.removed',
        entityType: 'insurance_card',
        entityId: cardId,
        afterJson: { patientId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** Ảnh thẻ (mặt trước/sau) — key mới mỗi lần, xoá file cũ SAU khi lưu thành công (cùng khuôn `PatientService.uploadPhoto`). */
  async uploadPhoto(
    tenantId: string,
    actorId: string,
    patientId: string,
    cardId: string,
    side: InsuranceCardPhotoSide,
    expectedVersion: number,
    fileBuffer: Buffer,
    meta: RequestMeta,
  ): Promise<SaveInsuranceCardResponse> {
    await this.assertEnabled(tenantId);
    if (fileBuffer.byteLength > MAX_INSURANCE_PHOTO_SIZE_BYTES) {
      throw new InvalidPhotoError('Ảnh vượt quá 3MB, vui lòng chọn ảnh nhỏ hơn.');
    }
    const extension = sniffImageExtension(fileBuffer);
    if (!extension) {
      throw new InvalidPhotoError('Chỉ nhận ảnh định dạng JPG hoặc PNG.');
    }
    const key = this.encryptionKey();
    const today = getVietnamDateString(new Date());

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.assertPatientUsable(tx, tenantId, patientId);
      const existing = await this.cardRepository.findById(tx, tenantId, patientId, cardId);
      if (!existing) throw new NotFoundException();

      const storageKey = `patient/${patientId}/insurance/${cardId}/${side}/${randomUUID()}.${extension}`;
      await this.storage.save(tenantId, storageKey, fileBuffer, extension === 'jpg' ? 'image/jpeg' : 'image/png');
      const patch: UpdateInsuranceCardData = side === 'front' ? { photoFrontKey: storageKey } : { photoBackKey: storageKey };
      const count = await this.cardRepository.updateIfVersionMatches(tx, tenantId, patientId, cardId, expectedVersion, actorId, patch);
      if (count === 0) {
        await this.storage.delete(tenantId, storageKey);
        throw new ConcurrentModificationError();
      }
      const oldKey = side === 'front' ? existing.photoFrontKey : existing.photoBackKey;
      if (oldKey) await this.storage.delete(tenantId, oldKey);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'insurance_card.photo_updated',
        entityType: 'insurance_card',
        entityId: cardId,
        afterJson: { patientId, side },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.cardRepository.findById(tx, tenantId, patientId, cardId);
      if (!updated) throw new NotFoundException();
      return { card: this.toCard(tenantId, updated, key, today), warnings: [] };
    });
  }

  // ---------------------------------------------------------------- tìm bệnh nhân theo số thẻ

  /**
   * Danh sách id bệnh nhân có thẻ trùng CHÍNH XÁC số `rawQuery` (đã chuẩn hoá) — rỗng khi công tắc tắt hoặc chuỗi tìm không giống số thẻ.
   * Gọi TRƯỚC khi mở transaction của danh sách (đọc công tắc qua port), rồi truyền kết quả vào truy vấn.
   */
  async findPatientIdsByCardNo(tenantId: string, rawQuery: string): Promise<string[]> {
    const cardNo = normalizeInsuranceCardNo(rawQuery);
    if (detectInsuranceCardKind(cardNo) === 'UNKNOWN') return [];
    if (!(await this.clinicConfig.getInsuranceEnabled(tenantId))) return [];
    const key = this.encryptionKey();
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.cardRepository.findPatientIdsByHash(tx, tenantId, hashForLookup(cardHashInput(cardNo), key)));
  }

  // ---------------------------------------------------------------- bản chụp vào lượt khám (Tiếp nhận)

  /**
   * Bản chụp thẻ cho lượt khám MỚI. `enabled` đọc TRƯỚC transaction (xem ghi chú đầu lớp). Công tắc tắt → `{ selfPay: true }` đúng như trước S2-04.
   * `choice`: `undefined` = tự gợi ý, `null` = "Không dùng thẻ", uuid = thẻ đó (phải thuộc bệnh nhân, nếu không 404). Thẻ hết hạn/chưa hiệu lực
   * (kể cả khi lễ tân chọn tay) KHÔNG được chụp vào BHYT — lượt khám ghi tự chi trả kèm lý do.
   */
  async buildEncounterSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    choice: string | null | undefined,
    enabled: boolean,
  ): Promise<StoredInsuranceSnapshot> {
    if (!enabled) return { selfPay: true };
    if (choice === null) return { selfPay: true, reason: 'DECLINED' };
    const today = getVietnamDateString(new Date());
    const rows = await this.cardRepository.listForPatient(tx, tenantId, patientId);

    let picked: InsuranceCardRow | null = null;
    if (choice !== undefined) {
      picked = rows.find((r) => r.id === choice) ?? null;
      if (!picked) throw new NotFoundException();
    } else {
      const suggestion = pickSuggestedInsuranceCard(
        rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), validFrom: isoDate(r.validFrom), validTo: isoDate(r.validTo) })),
        today,
      );
      picked = suggestion ? (rows.find((r) => r.id === suggestion.id) ?? null) : null;
    }

    if (!picked) {
      const anyExpired = rows.some((r) => resolveInsuranceCardValidity({ validFrom: isoDate(r.validFrom), validTo: isoDate(r.validTo) }, today) === 'EXPIRED');
      return { selfPay: true, reason: rows.length === 0 ? 'NO_CARD' : anyExpired ? 'EXPIRED' : 'NOT_STARTED' };
    }
    const validity = resolveInsuranceCardValidity({ validFrom: isoDate(picked.validFrom), validTo: isoDate(picked.validTo) }, today);
    if (validity === 'EXPIRED') return { selfPay: true, reason: 'EXPIRED' };
    if (validity === 'NOT_STARTED') return { selfPay: true, reason: 'NOT_STARTED' };
    return {
      selfPay: false,
      cardId: picked.id,
      // Số thẻ giữ nguyên bản MÃ HOÁ (cùng khoá) — không bao giờ để plaintext trong JSONB.
      cardNoEnc: Buffer.from(picked.cardNoEnc).toString('base64'),
      validFrom: isoDate(picked.validFrom),
      validTo: isoDate(picked.validTo),
      facilityCode: picked.facilityCode,
      facilityName: picked.facilityName,
      benefitRate: picked.benefitRate,
    };
  }

  /** Đọc bản chụp trên lượt khám → DTO đầy đủ (đã giải mã số thẻ). Công tắc tắt → `null` (giao diện không hiện gì). */
  toEncounterInsurance(snapshotJson: unknown, enabled: boolean): EncounterInsurance | null {
    if (!enabled) return null;
    const parsed = storedInsuranceSnapshotSchema.safeParse(snapshotJson);
    const snap: StoredInsuranceSnapshot = parsed.success ? parsed.data : { selfPay: true };
    let cardNo: string | null = null;
    let cardNoUnreadable = false;
    if (!snap.selfPay && snap.cardNoEnc) {
      cardNo = tryDecryptPii(Buffer.from(snap.cardNoEnc, 'base64'), this.encryptionKey());
      cardNoUnreadable = cardNo === null;
    }
    return {
      selfPay: snap.selfPay,
      reason: snap.reason ?? null,
      cardNo,
      cardNoUnreadable,
      kind: cardNo ? detectInsuranceCardKind(cardNo) : null,
      validFrom: snap.validFrom ?? null,
      validTo: snap.validTo ?? null,
      facilityCode: snap.facilityCode ?? null,
      facilityName: snap.facilityName ?? null,
      benefitRate: snap.benefitRate ?? null,
    };
  }

  /** Nhãn gọn cho danh sách/hàng đợi — KHÔNG giải mã, không chứa số thẻ. */
  toBadge(snapshotJson: unknown, enabled: boolean): EncounterInsuranceBadge | null {
    if (!enabled) return null;
    const parsed = storedInsuranceSnapshotSchema.safeParse(snapshotJson);
    const snap: StoredInsuranceSnapshot = parsed.success ? parsed.data : { selfPay: true };
    return { selfPay: snap.selfPay, benefitRate: snap.selfPay ? null : (snap.benefitRate ?? null) };
  }

  // ---------------------------------------------------------------- nội bộ

  private encryptionKey(): string {
    return this.configService.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async assertEnabled(tenantId: string): Promise<void> {
    if (!(await this.clinicConfig.getInsuranceEnabled(tenantId))) throw new InsuranceDisabledError();
  }

  private requireCardNo(raw: string): string {
    const cardNo = normalizeInsuranceCardNo(raw);
    if (cardNo.length === 0) throw new BadRequestException('Vui lòng nhập số thẻ.');
    return cardNo;
  }

  private warnings(cardNo: string, duplicate: boolean): InsuranceCardWarning[] {
    const out: InsuranceCardWarning[] = [];
    if (detectInsuranceCardKind(cardNo) === 'UNKNOWN') out.push('UNRECOGNIZED_FORMAT');
    if (duplicate) out.push('DUPLICATE_CARD_NO');
    return out;
  }

  private async assertPatientExists(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<void> {
    const patient = await this.patientRepository.findById(tx, tenantId, patientId);
    if (!patient) throw new NotFoundException();
  }

  /** Thêm/sửa/xoá thẻ: hồ sơ đã gộp vào hồ sơ khác không còn nhận thay đổi. */
  private async assertPatientUsable(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<void> {
    const patient = await this.patientRepository.findById(tx, tenantId, patientId);
    if (!patient) throw new NotFoundException();
    if (patient.mergedIntoId !== null) throw new PatientAlreadyMergedError();
  }

  private toCard(tenantId: string, row: InsuranceCardRow, key: string, today: string): InsuranceCard {
    // Khoá không khớp → số thẻ rỗng (thẻ vẫn hiện trong danh sách, kiểu "không rõ"); không để cả danh sách lỗi 500 (#262).
    const decrypted = tryDecryptPii(Buffer.from(row.cardNoEnc), key);
    const cardNo = decrypted ?? '';
    const validFrom = isoDate(row.validFrom);
    const validTo = isoDate(row.validTo);
    return {
      id: row.id,
      patientId: row.patientId,
      cardNo,
      cardNoUnreadable: decrypted === null,
      kind: detectInsuranceCardKind(cardNo),
      validFrom,
      validTo,
      validity: resolveInsuranceCardValidity({ validFrom, validTo }, today),
      facilityCode: row.facilityCode,
      facilityName: row.facilityName,
      benefitRate: row.benefitRate,
      photoFrontUrl: row.photoFrontKey ? this.signPhotoUrl(tenantId, row.photoFrontKey, key) : null,
      photoBackUrl: row.photoBackKey ? this.signPhotoUrl(tenantId, row.photoBackKey, key) : null,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }

  private signPhotoUrl(tenantId: string, key: string, encryptionKey: string): string {
    const exp = Math.floor(Date.now() / 1000) + PHOTO_URL_TTL_SECONDS;
    return `/api/v1/files/${signFileToken({ tenantId, key, exp }, encryptionKey)}`;
  }
}
