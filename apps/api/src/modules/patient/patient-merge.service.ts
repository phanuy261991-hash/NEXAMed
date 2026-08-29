import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, PatientAlreadyMergedError } from '@nexamed/core';
import type { MergePatientsRequest, MergePatientsResponse } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { PatientRepository } from './patient.repository';
import { PatientAllergenRepository } from './patient-allergen.repository';
import { PatientConditionRepository } from './patient-condition.repository';
import { PatientFamilyHistoryRepository, type FamilyHistoryRowInput } from './patient-family-history.repository';
import { EncounterRepository } from '../encounter/encounter.repository';

/**
 * Gộp hồ sơ trùng (S5-06, PAT-04) — module điều phối riêng (`patient-merge.module.ts`), không
 * gộp chung vào `PatientService` vì đây là use case khác hẳn CRUD hồ sơ, chạm nhiều bảng thuộc
 * cả `patient` lẫn `encounter`. Chỉ chuyển `encounter` + 3 bảng tiền sử có cấu trúc sang hồ sơ
 * đích (đã hỏi và chốt với chủ dự án) — KHÔNG đụng field nào khác (địa chỉ/SĐT/ghi chú...) của
 * hồ sơ đích, KHÔNG đụng `appointment.patientId`.
 */
@Injectable()
export class PatientMergeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly patientRepository: PatientRepository,
    private readonly patientAllergenRepository: PatientAllergenRepository,
    private readonly patientConditionRepository: PatientConditionRepository,
    private readonly patientFamilyHistoryRepository: PatientFamilyHistoryRepository,
    private readonly encounterRepository: EncounterRepository,
  ) {}

  async mergePatients(tenantId: string, actorId: string, dto: MergePatientsRequest, meta: RequestMeta): Promise<MergePatientsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [source, target] = await Promise.all([
        this.patientRepository.findById(tx, tenantId, dto.sourceId),
        this.patientRepository.findById(tx, tenantId, dto.targetId),
      ]);
      if (!source || !target) {
        throw new NotFoundException();
      }
      if (source.mergedIntoId !== null || target.mergedIntoId !== null) {
        throw new PatientAlreadyMergedError();
      }

      const movedEncounterCount = await this.encounterRepository.reassignPatientId(tx, tenantId, dto.sourceId, dto.targetId, actorId);

      const [sourceAllergens, targetAllergens] = await Promise.all([
        this.patientAllergenRepository.listForPatient(tx, tenantId, dto.sourceId),
        this.patientAllergenRepository.listForPatient(tx, tenantId, dto.targetId),
      ]);
      const mergedAllergenIds = Array.from(new Set([...targetAllergens.map((a) => a.allergenId), ...sourceAllergens.map((a) => a.allergenId)]));

      const [sourceConditions, targetConditions] = await Promise.all([
        this.patientConditionRepository.listForPatient(tx, tenantId, dto.sourceId),
        this.patientConditionRepository.listForPatient(tx, tenantId, dto.targetId),
      ]);
      const mergedConditionCodes = Array.from(new Set([...targetConditions.map((c) => c.icd10Code), ...sourceConditions.map((c) => c.icd10Code)]));

      const [sourceFamilyHistory, targetFamilyHistory] = await Promise.all([
        this.patientFamilyHistoryRepository.listForPatient(tx, tenantId, dto.sourceId),
        this.patientFamilyHistoryRepository.listForPatient(tx, tenantId, dto.targetId),
      ]);
      const mergedFamilyHistoryRows = mergeFamilyHistory(targetFamilyHistory, sourceFamilyHistory);

      await Promise.all([
        this.patientAllergenRepository.replaceForPatient(tx, tenantId, dto.targetId, actorId, mergedAllergenIds),
        this.patientAllergenRepository.replaceForPatient(tx, tenantId, dto.sourceId, actorId, []),
        this.patientConditionRepository.replaceForPatient(tx, tenantId, dto.targetId, actorId, mergedConditionCodes),
        this.patientConditionRepository.replaceForPatient(tx, tenantId, dto.sourceId, actorId, []),
        this.patientFamilyHistoryRepository.replaceForPatient(tx, tenantId, dto.targetId, actorId, mergedFamilyHistoryRows),
        this.patientFamilyHistoryRepository.replaceForPatient(tx, tenantId, dto.sourceId, actorId, []),
      ]);

      const updatedCount = await this.patientRepository.updateIfVersionMatches(tx, tenantId, dto.sourceId, source.version, actorId, {
        mergedIntoId: dto.targetId,
      });
      if (updatedCount === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.merged',
        entityType: 'patient',
        entityId: dto.sourceId,
        afterJson: { mergedIntoId: dto.targetId, movedEncounterCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { sourceId: dto.sourceId, targetId: dto.targetId, movedEncounterCount };
    });
  }
}

interface FamilyHistoryRow {
  relation: FamilyHistoryRowInput['relation'];
  icd10Code: string;
  ageOfOnsetYears: number | null;
}

/** Union theo cặp `(relation, icd10Code)` — ưu tiên `ageOfOnsetYears` của dòng đã có ở hồ sơ đích khi trùng. */
function mergeFamilyHistory(target: FamilyHistoryRow[], source: FamilyHistoryRow[]): FamilyHistoryRowInput[] {
  const key = (r: FamilyHistoryRow) => `${r.relation}:${r.icd10Code}`;
  const map = new Map<string, FamilyHistoryRowInput>();
  for (const row of target) {
    map.set(key(row), { relation: row.relation, icd10Code: row.icd10Code, ageOfOnsetYears: row.ageOfOnsetYears ?? undefined });
  }
  for (const row of source) {
    if (!map.has(key(row))) {
      map.set(key(row), { relation: row.relation, icd10Code: row.icd10Code, ageOfOnsetYears: row.ageOfOnsetYears ?? undefined });
    }
  }
  return Array.from(map.values());
}
