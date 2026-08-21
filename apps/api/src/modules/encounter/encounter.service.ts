import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ConcurrentModificationError,
  DiagnosisPrimaryRequiredError,
  DOCTOR_DIRECTORY_PORT,
  EncounterAlreadyClaimedError,
  EncounterNotInConsultationError,
  assertEncounterTransition,
  evaluateVitalSignWarnings,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import { calculateAgeYears } from '@nexamed/shared';
import type {
  CancelEncounterRequest,
  ClinicalNoteResponse,
  ClinicalNoteSection,
  CompleteConsultationRequest,
  ConsultationDetailResponse,
  DataScope,
  DiagnosisItem,
  EncounterSummary,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  StartConsultationRequest,
  VitalSignResponse,
} from '@nexamed/shared';
import type { Prisma, VitalSign } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository, type DiagnosisWithIcd10Name } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { toEncounterSummary } from './encounter.mapper';

const TEMPERATURE_DECI_PER_CELSIUS = 10;
/** Số lần khám cũ tối đa hiện trong panel tiền sử (ENC-01) — danh sách tóm tắt, không phân trang ở v1. */
const CONSULTATION_HISTORY_LIMIT = 20;

/**
 * Điều phối use case chuyển trạng thái `encounter` (Sprint 3) — "Bắt đầu khám"
 * (`CHECKED_IN→IN_CONSULTATION`) và "bỏ về" (`CHECKED_IN→CANCELLED`). Tạo encounter (check-in)
 * KHÔNG thuộc module này — đó là `ReceptionService` (đúng ranh giới `architecture.md`: `reception`
 * = tạo encounter + sinh hiệu ban đầu; `encounter` = state machine + transition).
 */
@Injectable()
export class EncounterService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly encounterRepository: EncounterRepository,
    private readonly diagnosisRepository: DiagnosisRepository,
    private readonly clinicalNoteRepository: ClinicalNoteRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /**
   * "Bắt đầu khám" — 2 nhánh tuỳ `existing.doctorId` ("Hàng đợi ảo", #064):
   * - Đã có bác sĩ phụ trách (bình thường): chỉ chính bác sĩ đó (`data_scope=personal`, mirror
   *   `appointment.update`) hoặc actor scope rộng hơn mới thao tác được.
   * - Chưa có ai (`doctorId=NULL`, ticket trong hàng chờ chung Khoa): đây là "Nhận ca" — chỉ bác sĩ
   *   (`personal`) CÙNG Khoa với ticket mới claim được (chặn claim chéo Khoa), set `doctorId=actor`
   *   ngay lúc chuyển trạng thái. Chống trùng khi 2 bác sĩ bấm gần như đồng thời là FALLBACK (ghi
   *   có điều kiện `WHERE doctor_id IS NULL`, không WebSocket) — người thua nhận
   *   `EncounterAlreadyClaimedError` thay vì lỗi version chung chung.
   */
  async startConsultation(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: StartConsultationRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    // `DoctorDirectoryPort` tự mở transaction RIÊNG (adapter chỉ nhận `tenantId`) — resolve Khoa
    // của actor TRƯỚC khi vào transaction chính bên dưới để tránh $transaction lồng nhau (đúng
    // nguyên tắc port không dùng chung tx với thao tác cần atomic, xem docs/DECISIONS.md). Chỉ cần
    // cho bác sĩ (scope `personal`) — actor khác không bao giờ "Nhận ca" được (nhánh else dưới).
    const actorDepartmentId = dataScope === 'personal' ? await this.doctorDirectory.getDoctorDepartmentId(tenantId, actorId) : null;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      if (existing.doctorId !== null) {
        // Cùng triết lý 404 (không 403) khi ngoài scope personal — .claude/docs/multi-tenancy.md,
        // đúng mẫu AppointmentService.getAppointment().
        if (dataScope === 'personal' && existing.doctorId !== actorId) {
          throw new NotFoundException();
        }
        assertEncounterTransition(existing.status, 'IN_CONSULTATION');
        const count = await this.encounterRepository.startConsultation(tx, tenantId, id, dto.version, actorId);
        if (count === 0) {
          throw new ConcurrentModificationError();
        }
      } else {
        // "Nhận ca" — chỉ bác sĩ (personal), và chỉ khi Khoa của actor khớp Khoa của ticket.
        if (dataScope !== 'personal' || actorDepartmentId === null || actorDepartmentId !== existing.departmentId) {
          throw new NotFoundException();
        }
        assertEncounterTransition(existing.status, 'IN_CONSULTATION');
        const count = await this.encounterRepository.claimFromPool(tx, tenantId, id, dto.version, actorId);
        if (count === 0) {
          const recheck = await this.encounterRepository.findById(tx, tenantId, id);
          if (recheck && recheck.doctorId !== null) {
            throw new EncounterAlreadyClaimedError();
          }
          throw new ConcurrentModificationError();
        }
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.consultation_started',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.encounterRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return toEncounterSummary(updated);
    });
  }

  /** "Bỏ về" — bắt buộc lý do (.claude/docs/clinical-workflow.md). `data_scope=personal` cho bác sĩ, `global` cho lễ tân/clinic_admin. */
  async cancelEncounter(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: CancelEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      assertEncounterTransition(existing.status, 'CANCELLED');

      const count = await this.encounterRepository.cancel(tx, tenantId, id, dto.version, dto.cancelReason, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.cancelled',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.encounterRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return toEncounterSummary(updated);
    });
  }

  /**
   * Màn hình khám (S3-05) — gộp tiền sử + dị ứng + sinh hiệu trong MỘT request (.claude/docs/
   * data-model.md). `encounter.read` đã `global` cho doctor/nurse/receptionist (xem
   * `packages/core/src/rbac/permissions.ts`) nên đọc không giới hạn theo bác sĩ phụ trách — vẫn
   * kiểm `personal` phòng khi vai trò tuỳ biến gán scope hẹp hơn, cùng triết lý mọi method khác.
   */
  async getConsultationDetail(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<ConsultationDetailResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findByIdWithConsultationContext(tx, tenantId, id);
      if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) {
        throw new NotFoundException();
      }

      const latestVitalSign = encounter.vitalSigns[0] ?? null;
      const vitalSigns = latestVitalSign ? this.toVitalSignResponse(latestVitalSign, encounter.patient.dob) : null;

      const historyRows = await this.encounterRepository.listHistoryForPatient(tx, tenantId, encounter.patientId, id, CONSULTATION_HISTORY_LIMIT);
      const history = historyRows.map((row) => ({
        encounterId: row.id,
        checkedInAt: row.checkedInAt.toISOString(),
        chiefComplaint: row.chiefComplaint,
        primaryDiagnosisName: row.diagnoses[0]?.icd10.nameVi ?? null,
      }));

      const diagnosisRows = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);
      const diagnoses = diagnosisRows.map((row) => this.toDiagnosisItem(row));

      const noteRows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);

      return {
        encounter: toEncounterSummary(encounter),
        patient: {
          id: encounter.patient.id,
          patientCode: encounter.patient.patientCode,
          fullName: encounter.patient.fullName,
          dob: encounter.patient.dob.toISOString().slice(0, 10),
          gender: encounter.patient.gender,
          phone: encounter.patient.phone,
          allergyNote: encounter.patient.allergyNote,
          version: encounter.patient.version,
        },
        vitalSigns,
        history,
        diagnoses,
        clinicalNote: this.toClinicalNoteResponse(noteRows),
      };
    });
  }

  /**
   * Thay thế toàn bộ danh sách chẩn đoán của lượt khám — `diagnosis.create` (`personal`, kế thừa
   * quyền sở hữu qua `encounter.doctorId` vì bảng `diagnosis` không có cột `doctorId` riêng, xem
   * `.claude/docs/security-audit.md`). `saveDiagnosesRequestSchema` (Zod) đã chặn phần lớn payload
   * sai (không có/nhiều hơn 1 PRIMARY) — kiểm lại ở đây là lớp phòng thủ thứ hai, không phải kiểm
   * dư thừa (service không tin tưởng input đã qua Zod là bất biến nghiệp vụ đúng tuyệt đối).
   *
   * **Sửa sau khi đã "Hoàn tất khám" (`status=COMPLETED`) được phép** — lỗi vận hành thật chủ dự án
   * báo cáo: trước đây "Xem lại" một lượt khám đã hoàn tất vẫn hiện y hệt giao diện đang khám nhưng
   * MỌI lần lưu đều bị chặn cứng (`EncounterNotInConsultationError`), không có đường nào sửa sai sót
   * phát hiện sau đó. Quyết định (xem `docs/DECISIONS.md`): mở khoá sửa TẠI CHỖ (không tạo bản ghi
   * mới kiểu đính chính — đó là ENC-04/05/Sprint 5, áp dụng cho bản ghi đã `signed_at`; `diagnosis`
   * v1 chưa có khái niệm ký) + ghi đầy đủ `audit_log` trước/sau bằng action riêng để tra được ai sửa
   * gì lúc nào. Quyền vẫn y nguyên cơ chế đã có: đúng bác sĩ ca đó (`personal`, ownership check ở
   * trên) hoặc tài khoản khác qua break-glass (permission.guard.ts, không đổi gì thêm ở đây).
   */
  async saveDiagnoses(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SaveDiagnosesRequest,
    meta: RequestMeta,
  ): Promise<SaveDiagnosesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const isPostCompletionEdit = existing.status === 'COMPLETED';
      if (existing.status !== 'IN_CONSULTATION' && !isPostCompletionEdit) {
        throw new EncounterNotInConsultationError();
      }
      const primaryCount = dto.diagnoses.filter((d) => d.type === 'PRIMARY').length;
      if (primaryCount !== 1) {
        throw new DiagnosisPrimaryRequiredError();
      }

      const beforeRows = isPostCompletionEdit ? await this.diagnosisRepository.listForEncounter(tx, tenantId, id) : null;

      await this.diagnosisRepository.replaceForEncounter(
        tx,
        tenantId,
        id,
        actorId,
        dto.diagnoses.map((d) => ({ icd10Code: d.icd10Code, type: d.type, note: d.note ?? null })),
      );

      const rows = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isPostCompletionEdit ? 'encounter.diagnosis_amended_after_completion' : 'encounter.diagnosis_saved',
        entityType: 'encounter',
        entityId: id,
        beforeJson: beforeRows ? (beforeRows.map((r) => ({ icd10Code: r.icd10Code, type: r.type, note: r.note })) as Prisma.InputJsonValue) : undefined,
        afterJson: beforeRows ? (rows.map((r) => ({ icd10Code: r.icd10Code, type: r.type, note: r.note })) as Prisma.InputJsonValue) : undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { items: rows.map((row) => this.toDiagnosisItem(row)) };
    });
  }

  /**
   * Lưu cả 8 mục ghi chú lâm sàng trong một request (khớp form 1 lần bấm "Lưu nháp" HOẶC autosave
   * định kỳ từ web — xem `docs/DECISIONS.md`, đảo ngược ghi chú "không autosave" ban đầu). Bản
   * nháp — `signedAt` luôn null, không có logic bất biến/đính chính ở vòng này (ENC-04/Sprint 5).
   *
   * **Sửa sau khi đã "Hoàn tất khám" được phép** — cùng quyết định + lý do như `saveDiagnoses()` ở
   * trên (đọc docstring đó trước). Ghi trước/sau đầy đủ nội dung 8 mục vào `audit_log` khi sửa sau
   * hoàn tất, vì đây chính là mục "phải lưu log lại" chủ dự án yêu cầu.
   */
  async saveClinicalNote(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SaveClinicalNoteRequest,
    meta: RequestMeta,
  ): Promise<ClinicalNoteResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const isPostCompletionEdit = existing.status === 'COMPLETED';
      if (existing.status !== 'IN_CONSULTATION' && !isPostCompletionEdit) {
        throw new EncounterNotInConsultationError();
      }

      const beforeRows = isPostCompletionEdit ? await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id) : null;

      const sections: { section: ClinicalNoteSection; input: SaveClinicalNoteRequest['reasonForVisit'] }[] = [
        { section: 'PERSONAL_HISTORY', input: dto.personalHistory },
        { section: 'FAMILY_HISTORY', input: dto.familyHistory },
        { section: 'REASON_FOR_VISIT', input: dto.reasonForVisit },
        { section: 'ILLNESS_PROGRESS', input: dto.illnessProgress },
        { section: 'PRELIMINARY_DIAGNOSIS', input: dto.preliminaryDiagnosis },
        { section: 'GENERAL_EXAM', input: dto.generalExam },
        { section: 'REGIONAL_EXAM', input: dto.regionalExam },
        { section: 'PLAN', input: dto.plan },
      ];
      for (const { section, input } of sections) {
        const result = await this.clinicalNoteRepository.upsertSection(tx, tenantId, id, section, input.content, input.version, actorId);
        if (result === 0) {
          throw new ConcurrentModificationError();
        }
      }

      const rows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isPostCompletionEdit ? 'encounter.clinical_note_amended_after_completion' : 'encounter.clinical_note_saved',
        entityType: 'encounter',
        entityId: id,
        beforeJson: beforeRows ? (Object.fromEntries(beforeRows.map((r) => [r.section, r.content])) as Prisma.InputJsonValue) : undefined,
        afterJson: beforeRows ? (Object.fromEntries(rows.map((r) => [r.section, r.content])) as Prisma.InputJsonValue) : undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toClinicalNoteResponse(rows);
    });
  }

  /**
   * "Hoàn tất khám" — `IN_CONSULTATION → COMPLETED`. Chỉ yêu cầu đúng một chẩn đoán chính
   * (.claude/docs/clinical-workflow.md) — KHÔNG phụ thuộc Kê đơn (module `prescription`, Sprint 4,
   * chưa xây) theo xác nhận của chủ dự án. Tái dùng permission `encounter.update` (đã dùng cho
   * "bắt đầu khám") — coi đây là một dạng chuyển trạng thái khác của cùng hành động, không thêm
   * permission mới.
   */
  async completeConsultation(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: CompleteConsultationRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      assertEncounterTransition(existing.status, 'COMPLETED');

      const primaryCount = await this.diagnosisRepository.countPrimary(tx, tenantId, id);
      if (primaryCount !== 1) {
        throw new DiagnosisPrimaryRequiredError();
      }

      const count = await this.encounterRepository.complete(tx, tenantId, id, dto.version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.completed',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.encounterRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return toEncounterSummary(updated);
    });
  }

  private toVitalSignResponse(vitalSign: VitalSign, dob: Date): VitalSignResponse {
    const ageYears = calculateAgeYears(dob.toISOString().slice(0, 10), vitalSign.measuredAt);
    const warnings = evaluateVitalSignWarnings(
      {
        pulse: vitalSign.pulse ?? undefined,
        temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : undefined,
        bpSystolic: vitalSign.bpSystolic ?? undefined,
        bpDiastolic: vitalSign.bpDiastolic ?? undefined,
        respiratoryRate: vitalSign.respiratoryRate ?? undefined,
        spo2: vitalSign.spo2 ?? undefined,
        weightGram: vitalSign.weightGram ?? undefined,
        heightMm: vitalSign.heightMm ?? undefined,
      },
      ageYears,
    );
    return {
      id: vitalSign.id,
      encounterId: vitalSign.encounterId,
      pulse: vitalSign.pulse,
      temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : null,
      bpSystolic: vitalSign.bpSystolic,
      bpDiastolic: vitalSign.bpDiastolic,
      respiratoryRate: vitalSign.respiratoryRate,
      spo2: vitalSign.spo2,
      weightGram: vitalSign.weightGram,
      heightMm: vitalSign.heightMm,
      measuredAt: vitalSign.measuredAt.toISOString(),
      warnings,
    };
  }

  private toDiagnosisItem(row: DiagnosisWithIcd10Name): DiagnosisItem {
    return {
      id: row.id,
      icd10Code: row.icd10Code,
      icd10Name: row.icd10.nameVi,
      type: row.type,
      note: row.note,
      version: row.version,
    };
  }

  private toClinicalNoteResponse(rows: { section: string; content: string; version: number }[]): ClinicalNoteResponse {
    const bySection = new Map(rows.map((row) => [row.section, { content: row.content, version: row.version }]));
    return {
      personalHistory: bySection.get('PERSONAL_HISTORY') ?? null,
      familyHistory: bySection.get('FAMILY_HISTORY') ?? null,
      reasonForVisit: bySection.get('REASON_FOR_VISIT') ?? null,
      illnessProgress: bySection.get('ILLNESS_PROGRESS') ?? null,
      preliminaryDiagnosis: bySection.get('PRELIMINARY_DIAGNOSIS') ?? null,
      generalExam: bySection.get('GENERAL_EXAM') ?? null,
      regionalExam: bySection.get('REGIONAL_EXAM') ?? null,
      plan: bySection.get('PLAN') ?? null,
    };
  }
}
