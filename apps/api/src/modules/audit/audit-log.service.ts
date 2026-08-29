import { Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  ENCOUNTER_READER_PORT,
  PATIENT_READER_PORT,
  vietnamDayRange,
  type DoctorDirectoryPort,
  type EncounterReaderPort,
  type PatientReaderPort,
} from '@nexamed/core';
import {
  isBreakGlassAction,
  labelForAuditAction,
  labelForEntityType,
  type AuditLogEntry,
  type ListAuditLogQuery,
  type ListAuditLogResponse,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AuditLogRepository } from './audit-log.repository';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(PATIENT_READER_PORT) private readonly patientReader: PatientReaderPort,
    @Inject(ENCOUNTER_READER_PORT) private readonly encounterReader: EncounterReaderPort,
  ) {}

  async list(tenantId: string, query: ListAuditLogQuery): Promise<ListAuditLogResponse> {
    // Lọc "theo bệnh nhân" phải gồm cả entityType='encounter' của mọi lượt khám thuộc bệnh nhân đó
    // (xem AuditLogRepository.list()) — tra trước danh sách encounterId ngoài transaction đọc chính,
    // vì đến từ port (tự mở transaction riêng), không phải cùng `tx`.
    const encounterIdsForPatient = query.patientId
      ? await this.encounterReader.findIdsByPatientId(tenantId, query.patientId)
      : undefined;

    const occurredFrom = query.from ? vietnamDayRange(query.from).startUtc : undefined;
    const occurredTo = query.to ? vietnamDayRange(query.to).endUtc : undefined;

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.auditLogRepository.list(tx, tenantId, {
        take: query.limit + 1,
        cursor: query.cursor,
        patientId: query.patientId,
        encounterIdsForPatient,
        actorId: query.actorId,
        occurredFrom,
        occurredTo,
      }),
    );
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const lastItem = page[page.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    // Batch resolve tên hiển thị — actor luôn resolve được (mọi actor là user_account); entity chỉ
    // resolve cho 'patient'/'encounter' (giới hạn có chủ đích, xem kế hoạch S5-05).
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const patientEntityIds = [...new Set(page.filter((r) => r.entityType === 'patient').map((r) => r.entityId))];
    const encounterEntityIds = [...new Set(page.filter((r) => r.entityType === 'encounter').map((r) => r.entityId))];

    const [actorNames, patientSummaries, encounterSummaries] = await Promise.all([
      actorIds.length > 0 ? this.doctorDirectory.getUserFullNames(tenantId, actorIds) : Promise.resolve(new Map<string, string>()),
      patientEntityIds.length > 0 ? this.patientReader.findSummariesByIds(tenantId, patientEntityIds) : Promise.resolve([]),
      encounterEntityIds.length > 0 ? this.encounterReader.findSummariesByIds(tenantId, encounterEntityIds) : Promise.resolve([]),
    ]);

    // Lượt khám xuất hiện trong trang này cần thêm tên bệnh nhân của chính nó (patientId khác với
    // patientEntityIds ở trên — đó là các dòng entityType='patient').
    const encounterPatientIds = [...new Set(encounterSummaries.map((e) => e.patientId))];
    const extraPatientSummaries =
      encounterPatientIds.length > 0 ? await this.patientReader.findSummariesByIds(tenantId, encounterPatientIds) : [];
    const patientNameById = new Map([...patientSummaries, ...extraPatientSummaries].map((p) => [p.id, p]));
    const encounterById = new Map(encounterSummaries.map((e) => [e.id, e]));

    const items: AuditLogEntry[] = page.map((row) => {
      // Chỉ 'patient'/'encounter' resolve được tên bản ghi cụ thể — mọi entityType khác hiện thuần
      // nhãn tiếng Việt của loại dữ liệu (không lộ entityId thô, xem `labelForEntityType`).
      let entityLabel: string = labelForEntityType(row.entityType);
      if (row.entityType === 'patient') {
        const p = patientNameById.get(row.entityId);
        if (p) entityLabel = `${p.fullName} (${p.patientCode})`;
      } else if (row.entityType === 'encounter') {
        const e = encounterById.get(row.entityId);
        const p = e ? patientNameById.get(e.patientId) : undefined;
        if (e) entityLabel = `Lượt khám ${e.encounterNo}${p ? ` — ${p.fullName}` : ''}`;
      }
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorName: row.actorId ? (actorNames.get(row.actorId) ?? null) : null,
        action: row.action,
        actionLabel: labelForAuditAction(row.action),
        entityType: row.entityType,
        entityId: row.entityId,
        entityLabel,
        isBreakGlass: isBreakGlassAction(row.action),
        beforeJson: row.beforeJson,
        afterJson: row.afterJson,
      };
    });

    return { items, nextCursor };
  }
}
