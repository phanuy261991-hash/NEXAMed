import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Patient } from '@prisma/client';
import {
  ConcurrentModificationError,
  InvalidPhotoError,
  PatientDuplicateNationalIdError,
  STORAGE_PORT,
  formatDisplayCode,
  sniffImageExtension,
  stripVietnameseDiacritics,
  type StoragePort,
} from '@nexamed/core';
import type {
  CheckPatientDuplicateQuery,
  CheckPatientDuplicateResponse,
  CreatePatientRequest,
  ListPatientsQuery,
  ListPatientsResponse,
  PatientAddress,
  PatientByNationalIdQuery,
  PatientByNationalIdResponse,
  PatientByPhoneQuery,
  PatientByPhoneResponse,
  PatientDetail,
  PatientGender,
  PatientSummary,
  UpdatePatientRequest,
} from '@nexamed/shared';
import { randomUUID } from 'node:crypto';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { decryptPii, encryptPii, hashForLookup } from '../../infrastructure/crypto/pii-encryption';
import { signFileToken } from '../../infrastructure/storage/signed-url';
import type { RequestMeta } from '../../common/request-meta';
import { PatientRepository, type UpdatePatientData } from './patient.repository';
import { PatientAllergenRepository, type PatientAllergenRow } from './patient-allergen.repository';

/** Ảnh đại diện sống 15 phút — bằng access token TTL, tự làm mới mỗi lần gọi lại API chi tiết. */
const PHOTO_URL_TTL_SECONDS = 15 * 60;
/** Cũng dùng ở `patient.controller.ts` (giới hạn `FileInterceptor` — chặn sớm ở tầng multer, không đợi đọc hết buffer rồi mới từ chối). */
export const MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;

const PATIENT_CODE_PREFIX = 'BN';

/**
 * `patient_tenant_id_national_id_hash_key` là partial unique index tạo bằng raw SQL trong
 * migration (Prisma không hỗ trợ `@@unique` có điều kiện `WHERE`, xem prisma/migrations/
 * *_patient_s2_01), nên Prisma không map được `err.meta.target` về tên cột như các unique
 * constraint khai báo qua `@@unique` bình thường — `target` trả về rỗng/"(not available)" dù mã
 * lỗi P2002 đúng. Coi mọi P2002 khi tạo/sửa patient là trùng CCCD — hợp lý vì đây là unique
 * constraint duy nhất có nguy cơ va chạm thật từ input người dùng (`patient_code` do
 * `CodeSequenceRepository` cấp atomic, `(tenant_id, id)` là UUID v7 mới sinh).
 */
function isNationalIdHashConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Điều phối use case bệnh nhân (S2-01, PAT-01) — sinh `patient_code`, mã hoá/hash CCCD, ghi
 * audit trong cùng transaction. Xem .claude/docs/coding-standards.md mục "Tầng trong API".
 */
@Injectable()
export class PatientService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly patientRepository: PatientRepository,
    private readonly patientAllergenRepository: PatientAllergenRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly configService: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async createPatient(
    tenantId: string,
    actorId: string,
    dto: CreatePatientRequest,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const seq = await this.codeSequenceRepository.next(tx, tenantId, PATIENT_CODE_PREFIX, actorId);
      const patientCode = formatDisplayCode(PATIENT_CODE_PREFIX, new Date(), seq);

      let created: Patient;
      try {
        created = await this.patientRepository.create(tx, tenantId, actorId, {
          patientCode,
          fullName: dto.fullName,
          dob: new Date(dto.dob),
          gender: dto.gender,
          phone: dto.phone,
          nationalIdEnc: dto.nationalId ? encryptPii(dto.nationalId, encryptionKey) : null,
          nationalIdHash: dto.nationalId ? hashForLookup(dto.nationalId, encryptionKey) : null,
          addressJson: dto.address ?? Prisma.JsonNull,
          allergyNote: dto.allergyNote ?? null,
          personalHistory: dto.personalHistory ?? null,
          familyHistory: dto.familyHistory ?? null,
          nationalIdIssuedAt: dto.nationalIdIssuedAt ? new Date(dto.nationalIdIssuedAt) : null,
          nationalIdIssuedPlace: dto.nationalIdIssuedPlace ?? null,
          ethnicity: dto.ethnicity ?? null,
          nationality: dto.nationality ?? null,
          occupation: dto.occupation ?? null,
          insuranceNumber: dto.insuranceNumber ?? null,
          relativeFullName: dto.relativeFullName ?? null,
          relativeRelationship: dto.relativeRelationship ?? null,
          relativePhone: dto.relativePhone ?? null,
          relativeAddress: dto.relativeAddress ?? null,
        });
      } catch (err) {
        if (isNationalIdHashConflict(err)) {
          throw new PatientDuplicateNationalIdError();
        }
        throw err;
      }

      if (dto.allergenIds !== undefined && dto.allergenIds.length > 0) {
        await this.patientAllergenRepository.replaceForPatient(tx, tenantId, created.id, actorId, dto.allergenIds);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.created',
        entityType: 'patient',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergens = await this.patientAllergenRepository.listForPatient(tx, tenantId, created.id);
      return this.toDetail(created, encryptionKey, allergens);
    });
  }

  async getPatient(tenantId: string, id: string): Promise<PatientDetail> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const patient = await this.patientRepository.findById(tx, tenantId, id);
      if (!patient) {
        throw new NotFoundException();
      }
      const allergens = await this.patientAllergenRepository.listForPatient(tx, tenantId, id);
      return this.toDetail(patient, encryptionKey, allergens);
    });
  }

  async listPatients(tenantId: string, query: ListPatientsQuery): Promise<ListPatientsResponse> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const search = query.q ? { raw: query.q, normalized: stripVietnameseDiacritics(query.q) } : undefined;
      const rows = await this.patientRepository.list(tx, tenantId, {
        cursor: query.cursor,
        take: query.limit + 1,
        search,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.id : null;
      return { items: items.map((p) => this.toSummary(p, encryptionKey)), nextCursor };
    });
  }

  /**
   * PAT-03 — trùng "mềm": khớp CHÍNH XÁC tên đã chuẩn hoá (không dấu/viết thường, cùng hàm
   * `stripVietnameseDiacritics` đã dùng cho tìm kiếm PAT-02) + ngày sinh, khác `contains` của
   * `listPatients` vì mục đích là phát hiện hai hồ sơ trùng gần như tuyệt đối, không phải gợi ý
   * mọi tên chứa từ khoá. Không chặn tạo mới — chỉ trả danh sách để client tự quyết định.
   */
  async checkDuplicates(tenantId: string, query: CheckPatientDuplicateQuery): Promise<CheckPatientDuplicateResponse> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const normalizedFullName = stripVietnameseDiacritics(query.fullName);
      const rows = await this.patientRepository.findPossibleDuplicates(tx, tenantId, {
        normalizedFullName,
        dob: new Date(query.dob),
      });
      return { items: rows.map((p) => this.toSummary(p, encryptionKey)) };
    });
  }

  /** Tra trùng SĐT (cảnh báo mềm form Thêm/Sửa; chọn khách hàng ở trang Tiếp nhận) — xem `PatientRepository.findByPhone()`. */
  async findByPhone(tenantId: string, query: PatientByPhoneQuery): Promise<PatientByPhoneResponse> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.patientRepository.findByPhone(tx, tenantId, {
        phone: query.phone,
        excludePatientId: query.excludePatientId,
      });
      return { items: rows.map((p) => this.toSummary(p, encryptionKey)) };
    });
  }

  /**
   * Tra trùng CCCD (màn hình "Tiếp nhận bệnh nhân", mockup đã duyệt) — băm `nationalId` bằng
   * `hashForLookup` (cùng key `ENCRYPTION_KEY`, cùng cơ chế C3) rồi khớp CHÍNH XÁC
   * `nationalIdHash`, không giải mã/so sánh plaintext của người khác.
   */
  async findByNationalId(tenantId: string, query: PatientByNationalIdQuery): Promise<PatientByNationalIdResponse> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const nationalIdHash = hashForLookup(query.nationalId, encryptionKey);
      const rows = await this.patientRepository.findByNationalIdHash(tx, tenantId, {
        nationalIdHash,
        excludePatientId: query.excludePatientId,
      });
      return { items: rows.map((p) => this.toSummary(p, encryptionKey)) };
    });
  }

  async updatePatient(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdatePatientRequest,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.patientRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdatePatientData = {};
      if (dto.fullName !== undefined) patch.fullName = dto.fullName;
      if (dto.dob !== undefined) patch.dob = new Date(dto.dob);
      if (dto.gender !== undefined) patch.gender = dto.gender;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.allergyNote !== undefined) patch.allergyNote = dto.allergyNote;
      if (dto.personalHistory !== undefined) patch.personalHistory = dto.personalHistory;
      if (dto.familyHistory !== undefined) patch.familyHistory = dto.familyHistory;
      if (dto.address !== undefined) patch.addressJson = dto.address ?? Prisma.JsonNull;
      if (dto.nationalId !== undefined) {
        patch.nationalIdEnc = dto.nationalId ? encryptPii(dto.nationalId, encryptionKey) : null;
        patch.nationalIdHash = dto.nationalId ? hashForLookup(dto.nationalId, encryptionKey) : null;
      }
      if (dto.nationalIdIssuedAt !== undefined) patch.nationalIdIssuedAt = dto.nationalIdIssuedAt ? new Date(dto.nationalIdIssuedAt) : null;
      if (dto.nationalIdIssuedPlace !== undefined) patch.nationalIdIssuedPlace = dto.nationalIdIssuedPlace ?? null;
      if (dto.ethnicity !== undefined) patch.ethnicity = dto.ethnicity ?? null;
      if (dto.nationality !== undefined) patch.nationality = dto.nationality ?? null;
      if (dto.occupation !== undefined) patch.occupation = dto.occupation ?? null;
      if (dto.insuranceNumber !== undefined) patch.insuranceNumber = dto.insuranceNumber ?? null;
      if (dto.relativeFullName !== undefined) patch.relativeFullName = dto.relativeFullName ?? null;
      if (dto.relativeRelationship !== undefined) patch.relativeRelationship = dto.relativeRelationship ?? null;
      if (dto.relativePhone !== undefined) patch.relativePhone = dto.relativePhone ?? null;
      if (dto.relativeAddress !== undefined) patch.relativeAddress = dto.relativeAddress ?? null;

      let updatedCount: number;
      try {
        updatedCount = await this.patientRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      } catch (err) {
        if (isNationalIdHashConflict(err)) {
          throw new PatientDuplicateNationalIdError();
        }
        throw err;
      }
      if (updatedCount === 0) {
        throw new ConcurrentModificationError();
      }

      if (dto.allergenIds !== undefined) {
        await this.patientAllergenRepository.replaceForPatient(tx, tenantId, id, actorId, dto.allergenIds);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.updated',
        entityType: 'patient',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.patientRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      const allergens = await this.patientAllergenRepository.listForPatient(tx, tenantId, id);
      return this.toDetail(updated, encryptionKey, allergens);
    });
  }

  /**
   * `nationalIdMasked`/`address` cho danh sách (docs/DECISIONS.md #034 — bổ sung sau khi chủ dự
   * án yêu cầu thêm cột CCCD/Địa chỉ ở màn hình Danh sách bệnh nhân). Vẫn phải giải mã CCCD ở đây
   * để che 4 số cuối — đổi thoả hiệp "tránh giải mã hàng loạt" ban đầu (đã hỏi và chốt: che bớt
   * thay vì bỏ hẳn cột, chấp nhận giải mã mỗi trang danh sách vì AES-256-GCM rất nhanh, không phải
   * thuật toán cố ý chậm như hash mật khẩu).
   */
  private toSummary(patient: Patient, encryptionKey: string): PatientSummary {
    return {
      id: patient.id,
      patientCode: patient.patientCode,
      fullName: patient.fullName,
      dob: this.formatDob(patient.dob),
      gender: patient.gender as PatientGender,
      phone: patient.phone,
      hasNationalId: patient.nationalIdEnc !== null,
      nationalIdMasked: patient.nationalIdEnc ? this.maskNationalId(decryptPii(patient.nationalIdEnc, encryptionKey)) : null,
      address: (patient.addressJson as PatientAddress | null) ?? null,
      version: patient.version,
    };
  }

  /** "••••" + 4 ký tự cuối — đủ nhận diện/đối chiếu nhanh mà không lộ nguyên số CCCD trên màn hình dùng chung. */
  private maskNationalId(nationalId: string): string {
    return `••••${nationalId.slice(-4)}`;
  }

  private toDetail(patient: Patient, encryptionKey: string, allergens: PatientAllergenRow[]): PatientDetail {
    return {
      ...this.toSummary(patient, encryptionKey),
      nationalId: patient.nationalIdEnc ? decryptPii(patient.nationalIdEnc, encryptionKey) : null,
      nationalIdIssuedAt: patient.nationalIdIssuedAt ? this.formatDob(patient.nationalIdIssuedAt) : null,
      nationalIdIssuedPlace: patient.nationalIdIssuedPlace,
      ethnicity: patient.ethnicity,
      nationality: patient.nationality,
      occupation: patient.occupation,
      insuranceNumber: patient.insuranceNumber,
      allergyNote: patient.allergyNote,
      personalHistory: patient.personalHistory,
      familyHistory: patient.familyHistory,
      relativeFullName: patient.relativeFullName,
      relativeRelationship: patient.relativeRelationship,
      relativePhone: patient.relativePhone,
      relativeAddress: patient.relativeAddress,
      allergens: allergens.map((a) => ({ id: a.allergenId, name: a.allergenName, allergenGroupName: a.allergenGroupName })),
      photoUrl: patient.photoKey
        ? this.signPhotoUrl(patient.tenantId, patient.photoKey, encryptionKey)
        : null,
      mergedIntoId: patient.mergedIntoId,
    };
  }

  private signPhotoUrl(tenantId: string, key: string, encryptionKey: string): string {
    const exp = Math.floor(Date.now() / 1000) + PHOTO_URL_TTL_SECONDS;
    const token = signFileToken({ tenantId, key, exp }, encryptionKey);
    return `/api/v1/files/${token}`;
  }

  /**
   * Upload ảnh đại diện (docs/DECISIONS.md #034) — endpoint riêng vì `POST /patients` chưa có
   * `id` để đặt tên key lúc tạo. Key mới mỗi lần upload (tránh phục vụ nhầm ảnh cũ qua cache
   * trình duyệt/CDN sau này); xoá file cũ sau khi lưu file mới thành công, không phải trước —
   * tránh mất cả hai bản nếu `STORAGE_PORT.save()` lỗi giữa chừng.
   */
  async uploadPhoto(
    tenantId: string,
    actorId: string,
    id: string,
    expectedVersion: number,
    fileBuffer: Buffer,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    if (fileBuffer.byteLength > MAX_PHOTO_SIZE_BYTES) {
      throw new InvalidPhotoError('Ảnh vượt quá 3MB, vui lòng chọn ảnh nhỏ hơn.');
    }
    const extension = sniffImageExtension(fileBuffer);
    if (!extension) {
      throw new InvalidPhotoError('Chỉ nhận ảnh định dạng JPG hoặc PNG.');
    }

    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.patientRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const key = `patient/${id}/photo/${randomUUID()}.${extension}`;
      await this.storage.save(tenantId, key, fileBuffer, extension === 'jpg' ? 'image/jpeg' : 'image/png');

      const updatedCount = await this.patientRepository.updateIfVersionMatches(tx, tenantId, id, expectedVersion, actorId, {
        photoKey: key,
      });
      if (updatedCount === 0) {
        // Ảnh mới đã lưu nhưng cột chưa đổi — dọn ngay, không để rác không ai trỏ tới.
        await this.storage.delete(tenantId, key);
        throw new ConcurrentModificationError();
      }

      if (existing.photoKey) {
        await this.storage.delete(tenantId, existing.photoKey);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.photo_updated',
        entityType: 'patient',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.patientRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      const allergens = await this.patientAllergenRepository.listForPatient(tx, tenantId, id);
      return this.toDetail(updated, encryptionKey, allergens);
    });
  }

  private formatDob(dob: Date): string {
    return dob.toISOString().slice(0, 10);
  }
}
