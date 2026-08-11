import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Patient } from '@prisma/client';
import {
  ConcurrentModificationError,
  PatientDuplicateNationalIdError,
  formatDisplayCode,
  stripVietnameseDiacritics,
} from '@nexamed/core';
import type {
  CreatePatientRequest,
  ListPatientsQuery,
  ListPatientsResponse,
  PatientAddress,
  PatientDetail,
  PatientGender,
  PatientSummary,
  UpdatePatientRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { decryptPii, encryptPii, hashForLookup } from '../../infrastructure/crypto/pii-encryption';
import type { RequestMeta } from '../../common/request-meta';
import { PatientRepository, type UpdatePatientData } from './patient.repository';

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
    private readonly codeSequenceRepository: CodeSequenceRepository,
    private readonly configService: ConfigService,
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
        });
      } catch (err) {
        if (isNationalIdHashConflict(err)) {
          throw new PatientDuplicateNationalIdError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.created',
        entityType: 'patient',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toDetail(created, encryptionKey);
    });
  }

  async getPatient(tenantId: string, id: string): Promise<PatientDetail> {
    const encryptionKey = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const patient = await this.patientRepository.findById(tx, tenantId, id);
      if (!patient) {
        throw new NotFoundException();
      }
      return this.toDetail(patient, encryptionKey);
    });
  }

  async listPatients(tenantId: string, query: ListPatientsQuery): Promise<ListPatientsResponse> {
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
      return { items: items.map((p) => this.toSummary(p)), nextCursor };
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
      if (dto.address !== undefined) patch.addressJson = dto.address ?? Prisma.JsonNull;
      if (dto.nationalId !== undefined) {
        patch.nationalIdEnc = dto.nationalId ? encryptPii(dto.nationalId, encryptionKey) : null;
        patch.nationalIdHash = dto.nationalId ? hashForLookup(dto.nationalId, encryptionKey) : null;
      }

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
      return this.toDetail(updated, encryptionKey);
    });
  }

  private toSummary(patient: Patient): PatientSummary {
    return {
      id: patient.id,
      patientCode: patient.patientCode,
      fullName: patient.fullName,
      dob: this.formatDob(patient.dob),
      gender: patient.gender as PatientGender,
      phone: patient.phone,
      hasNationalId: patient.nationalIdEnc !== null,
      version: patient.version,
    };
  }

  private toDetail(patient: Patient, encryptionKey: string): PatientDetail {
    return {
      ...this.toSummary(patient),
      nationalId: patient.nationalIdEnc ? decryptPii(patient.nationalIdEnc, encryptionKey) : null,
      address: (patient.addressJson as PatientAddress | null) ?? null,
      allergyNote: patient.allergyNote,
      mergedIntoId: patient.mergedIntoId,
    };
  }

  private formatDob(dob: Date): string {
    return dob.toISOString().slice(0, 10);
  }
}
