import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INTEROP_GUARDIAN_AGE_MONTHS,
  InteropGuardianEditForbiddenError,
  InteropInfoLockedError,
  REFERENCE_CATALOG_READER_PORT,
  checkInteropReadiness,
  maxDataScope,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import {
  EMPTY_INTEROP_KIND_INFO,
  type DataScope,
  type EncounterInteropInfoResponse,
  type InteropKindInfoValue,
  type PrescriptionKind,
  type SaveEncounterInteropInfoRequest,
} from '@nexamed/shared';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { RequestMeta } from '../../common/request-meta';
import { PatientService } from '../patient/patient.service';
import { PrescriptionInteropService } from '../prescription-interop/prescription-interop.service';
import { PrescriptionSubmissionRepository } from '../prescription-interop/prescription-submission.repository';
import { EncounterInteropInfoRepository } from './encounter-interop-info.repository';
import { PrescriptionInteropDataService, type GatheredInteropEncounter } from './prescription-interop-data.service';

const LOCKED_STATUSES = new Set(['SENT', 'AMENDED']);
const FIELD_LABELS: Record<keyof InteropKindInfoValue, string> = {
  treatmentFormCode: 'hình thức điều trị',
  dosePeriodNumber: 'đợt dùng thuốc',
  doseFrom: 'từ ngày',
  doseTo: 'đến ngày',
  herbalDoses: 'số thang thuốc',
  herbalInstruction: 'cách sắc/uống',
};

/** Ô nào có nghĩa với loại đơn nào (cổng chỉ nhận đúng các ô đó) — ô thừa bị bỏ khi lưu. */
function sanitizeForKind(kind: PrescriptionKind, value: InteropKindInfoValue): InteropKindInfoValue {
  if (kind === 'C') return { ...EMPTY_INTEROP_KIND_INFO, treatmentFormCode: value.treatmentFormCode };
  const base = { ...EMPTY_INTEROP_KIND_INFO, dosePeriodNumber: value.dosePeriodNumber, doseFrom: value.doseFrom, doseTo: value.doseTo };
  return kind === 'Y' ? { ...base, herbalDoses: value.herbalDoses, herbalInstruction: value.herbalInstruction } : base;
}

/**
 * Ô bổ sung bắt buộc khi gửi đơn lên cổng Đơn thuốc quốc gia + dải kiểm dữ liệu (docs/DECISIONS.md #242 GĐ3, mockup 8a/8b). Lưu RIÊNG, không thuộc nội dung đơn đã ký nên sửa được cho tới khi đơn
 * được gửi; mọi thay đổi ghi nhật ký. Công tắc liên thông tắt → ẩn hẳn (GET trả `enabled=false`, PUT 404).
 * Hướng chi nhánh: theo lượt khám (chi nhánh hiện hành của phiên); lượt khám của chi nhánh khác → 404.
 */
@Injectable()
export class EncounterInteropInfoService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly dataService: PrescriptionInteropDataService,
    private readonly infoRepository: EncounterInteropInfoRepository,
    private readonly submissionRepository: PrescriptionSubmissionRepository,
    private readonly interopService: PrescriptionInteropService,
    private readonly patientService: PatientService,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
  ) {}

  private async gatherForUser(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, encounterId: string): Promise<GatheredInteropEncounter> {
    const gathered = await this.dataService.gather(tenantId, encounterId, { branchId });
    if (!gathered || (dataScope === 'personal' && gathered.encounterDoctorId !== actorId)) throw new NotFoundException();
    return gathered;
  }

  private async canEditPatient(tenantId: string, actorId: string): Promise<boolean> {
    const scope = maxDataScope(await this.unitOfWork.runInTenantScope(tenantId, (tx) => findScopesForUserPermission(tx, tenantId, actorId, 'patient', 'update')));
    return scope !== 'none';
  }

  async getInfo(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, encounterId: string): Promise<EncounterInteropInfoResponse> {
    const settings = await this.interopService.getRawSettings(tenantId);
    if (!settings.enabled) return { enabled: false, standardMode: false, signed: false, kinds: [], guardian: null, problems: [] };
    const gathered = await this.gatherForUser(tenantId, branchId, actorId, dataScope, encounterId);
    const canEdit = await this.canEditPatient(tenantId, actorId);

    const statusByCode = new Map(gathered.submissions.map((s) => [s.nationalCode, s.status]));
    const kinds = gathered.kinds.map((k) => {
      const status: EncounterInteropInfoResponse['kinds'][number]['submissionStatus'] = k.nationalCode ? (statusByCode.get(k.nationalCode) ?? 'NONE') : 'NONE';
      return {
        kind: k.kind,
        nationalCode: k.nationalCode,
        submissionStatus: status,
        editable: !LOCKED_STATUSES.has(status),
        info: k.stored,
        suggested: { dosePeriodNumber: k.suggestedDose?.number ?? null, doseFrom: k.suggestedDose?.from ?? null, doseTo: k.suggestedDose?.to ?? null },
      };
    });
    const problems = gathered.kinds.flatMap((k) => checkInteropReadiness(k.input));
    return {
      enabled: true,
      standardMode: gathered.standardMode,
      signed: gathered.prescription?.signed ?? false,
      kinds,
      guardian:
        gathered.patient.ageMonths < INTEROP_GUARDIAN_AGE_MONTHS
          ? {
              fullName: gathered.patient.relativeFullName,
              relationship: gathered.patient.relativeRelationship,
              phone: gathered.patient.relativePhone,
              address: gathered.patient.relativeAddress,
              patientVersion: gathered.patient.version,
              canEdit,
            }
          : null,
      problems,
    };
  }

  async saveInfo(
    tenantId: string,
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    encounterId: string,
    dto: SaveEncounterInteropInfoRequest,
    meta: RequestMeta,
  ): Promise<EncounterInteropInfoResponse> {
    const settings = await this.interopService.getRawSettings(tenantId);
    if (!settings.enabled) throw new NotFoundException();
    const gathered = await this.gatherForUser(tenantId, branchId, actorId, dataScope, encounterId);

    const statusByCode = new Map(gathered.submissions.map((s) => [s.nationalCode, s.status]));
    const prepared = dto.kinds.map((entry) => {
      const existing = gathered.kinds.find((k) => k.kind === entry.kind);
      if (!existing) throw new UnprocessableEntityException('Loại đơn này không có trong đơn thuốc của lượt khám.');
      const status = existing.nationalCode ? statusByCode.get(existing.nationalCode) : undefined;
      if (status && LOCKED_STATUSES.has(status)) throw new InteropInfoLockedError();
      const { kind, ...rest } = entry;
      const value = sanitizeForKind(kind, rest);
      if (value.doseFrom && value.doseTo && value.doseTo < value.doseFrom) throw new UnprocessableEntityException('"Đến ngày" của đợt dùng thuốc không được trước "Từ ngày".');
      return { kind, before: existing.stored, value };
    });
    // Hình thức điều trị phải là mục đang dùng của danh mục (mục đã lưu từ trước mà nay bị ẩn thì được giữ nguyên).
    for (const entry of prepared) {
      const code = entry.value.treatmentFormCode;
      if (code !== null && code !== entry.before.treatmentFormCode && !(await this.referenceCatalogReader.findActiveByCode(tenantId, 'TREATMENT_FORM', code))) {
        throw new UnprocessableEntityException('Hình thức điều trị không có trong danh mục (thêm ở Danh mục dùng chung → Hình thức điều trị).');
      }
    }

    // Người giám hộ → ghi ngược vào hồ sơ bệnh nhân (PatientService tự mở transaction riêng và tự ghi nhật ký sửa hồ sơ). Làm TRƯỚC để lỗi quyền/phiên bản dừng cả thao tác.
    if (dto.guardian) {
      if (!(await this.canEditPatient(tenantId, actorId))) throw new InteropGuardianEditForbiddenError();
      const { patientVersion, fullName, phone, address } = dto.guardian;
      await this.patientService.updatePatient(
        tenantId,
        actorId,
        gathered.patientId,
        { version: patientVersion, ...(fullName !== undefined ? { relativeFullName: fullName } : {}), ...(phone !== undefined ? { relativePhone: phone } : {}), ...(address !== undefined ? { relativeAddress: address } : {}) },
        meta,
      );
    }

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const changedKinds: { kind: PrescriptionKind; fields: string[] }[] = [];
      for (const entry of prepared) {
        const changed = await this.infoRepository.upsert(tx, tenantId, actorId, encounterId, entry.kind, entry.value);
        if (!changed) continue;
        const fields = (Object.keys(FIELD_LABELS) as (keyof InteropKindInfoValue)[]).filter((f) => entry.before[f] !== entry.value[f]).map((f) => FIELD_LABELS[f]);
        changedKinds.push({ kind: entry.kind, fields });
      }
      if (changedKinds.length > 0 || dto.guardian) {
        // Nhật ký chỉ ghi loại đơn + TÊN ô đã đổi, không ghi giá trị (cách sắc/uống, người giám hộ là dữ liệu cá nhân).
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'encounter.interop_info_updated',
          entityType: 'encounter',
          entityId: encounterId,
          afterJson: { kinds: changedKinds, guardianUpdated: Boolean(dto.guardian) } as unknown as Prisma.InputJsonValue,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        // Dữ liệu vừa bổ sung → các đơn đang chờ của lượt khám được bộ gửi xem lại ngay.
        await this.submissionRepository.resetNextAttemptForEncounter(tx, tenantId, actorId, encounterId);
      }
    });
    return this.getInfo(tenantId, branchId, actorId, dataScope, encounterId);
  }
}
