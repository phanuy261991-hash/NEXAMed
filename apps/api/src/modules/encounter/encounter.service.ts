import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  ClinicalRecordAlreadySignedError,
  ConcurrentModificationError,
  DiagnosisPrimaryRequiredError,
  DOCTOR_DIRECTORY_PORT,
  EncounterAlreadyClaimedError,
  EncounterNotInConsultationError,
  EncounterPaymentRequiredError,
  PrescriptionAlreadySignedError,
  PrescriptionEmptyError,
  PrescriptionRequiresDiagnosisError,
  SIGNATURE_PORT,
  assertEncounterTransition,
  evaluateVitalSignWarnings,
  findAllergyMatches,
  findDuplicateActiveIngredients,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type PrescriptionDrugLine,
  type SignaturePort,
} from '@nexamed/core';
import { FAMILY_RELATION_LABELS, calculateAgeYears } from '@nexamed/shared';
import type {
  AmendClinicalNoteRequest,
  AmendDiagnosesRequest,
  AmendPrescriptionRequest,
  CancelEncounterRequest,
  ClinicalNoteResponse,
  ClinicalNoteSection,
  CompleteConsultationRequest,
  ConsultationDetailResponse,
  DataScope,
  DiagnosisItem,
  EncounterSummary,
  Prescription as PrescriptionDto,
  PrescriptionItem as PrescriptionItemDto,
  PrescriptionResponse,
  PrescriptionWarning,
  ReleaseEncounterRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  SavePrescriptionItemsRequest,
  SignPrescriptionRequest,
  StartConsultationRequest,
  VitalSignResponse,
} from '@nexamed/shared';
import type { ClinicalNote, Prisma, VitalSign } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository, type DiagnosisWithIcd10Name } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { PrescriptionRepository, type PrescriptionWithItems } from './prescription.repository';
import { toEncounterSummary } from './encounter.mapper';
import { PatientAllergenRepository } from '../patient/patient-allergen.repository';
import { PatientConditionRepository } from '../patient/patient-condition.repository';
import { PatientFamilyHistoryRepository } from '../patient/patient-family-history.repository';
import { InvoiceRepository } from '../billing/invoice.repository';

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
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly patientAllergenRepository: PatientAllergenRepository,
    private readonly patientConditionRepository: PatientConditionRepository,
    private readonly patientFamilyHistoryRepository: PatientFamilyHistoryRepository,
    private readonly invoiceRepository: InvoiceRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(SIGNATURE_PORT) private readonly signaturePort: SignaturePort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
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
    // Thu ngân cơ bản (Sprint 5/6) — cấu hình cấp phòng khám, đọc TRƯỚC transaction chính cùng lý
    // do actorDepartmentId ở trên (port tự mở transaction riêng).
    const deferredPaymentEnabled = await this.clinicConfigReader.getDeferredPaymentEnabled(tenantId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findByIdWithInvoiceStatus(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      // Ý nghĩa thật checkbox "Thanh toán sau" (docs/DECISIONS.md #080) — chặn "Bắt đầu khám"/"Nhận
      // ca" khi còn phiếu thu UNPAID và không được phép nợ. Tắt tính năng ở cấp phòng khám thì
      // `allowsDeferredPayment` đã lưu bị BỎ QUA hoàn toàn (luôn coi như false), không chỉ đọc cột).
      // Kiểm SAU nhánh 404 scope (không phải trước) — tránh lộ trạng thái thanh toán của lượt khám
      // ngoài phạm vi actor (personal) qua mã lỗi trả về, cùng triết lý multi-tenancy.md "404 not 403".
      const paymentRequired = existing.status === 'CHECKED_IN' && existing.invoice?.status === 'UNPAID' && !(deferredPaymentEnabled && existing.allowsDeferredPayment);

      if (existing.doctorId !== null) {
        // Cùng triết lý 404 (không 403) khi ngoài scope personal — .claude/docs/multi-tenancy.md,
        // đúng mẫu AppointmentService.getAppointment().
        if (dataScope === 'personal' && existing.doctorId !== actorId) {
          throw new NotFoundException();
        }
        if (paymentRequired) {
          throw new EncounterPaymentRequiredError();
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
        if (paymentRequired) {
          throw new EncounterPaymentRequiredError();
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

  /**
   * "Khách bỏ về" — bắt buộc lý do (.claude/docs/clinical-workflow.md). `data_scope=personal` cho
   * bác sĩ (chỉ ca của chính mình), `global` cho lễ tân/clinic_admin (mọi ca). Từ #085 nhận cả
   * `CHECKED_IN` lẫn `IN_CONSULTATION` làm trạng thái nguồn (khách bỏ về giữa chừng sau khi bác sĩ
   * đã "Nhận ca"), xem `docs/DECISIONS.md` #085.
   *
   * Phiếu thu đi kèm xử lý trong CÙNG transaction (`InvoiceRepository` dùng chung, đúng "chia sẻ
   * Repository giữa module trong 1 transaction" #042): `UNPAID → CANCELLED`; `PAID` GIỮ NGUYÊN chờ
   * hoàn tiền riêng qua `POST /billing/invoices/:encounterId/refund` (quyền `invoice.refund`) —
   * lễ tân không có quyền hoàn tiền vẫn huỷ được ca ngay, không kẹt chờ admin.
   */
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
      // v1 không có luồng nào tạo encounter ở SCHEDULED (luôn thẳng CHECKED_IN, xem comment đầu
      // encounter-state-machine.ts) — `assertEncounterTransition` ở trên đã chặn mọi cạnh khác,
      // narrow an toàn cho tham số `fromStatus` của repository.
      const fromStatus = existing.status as 'CHECKED_IN' | 'IN_CONSULTATION';

      const count = await this.encounterRepository.cancel(tx, tenantId, id, fromStatus, dto.version, dto.cancelReason, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      // #085 — đóng phiếu thu CHƯA thu (nếu có). `count=0` là bình thường (phiếu đã PAID chờ hoàn
      // tiền riêng, hoặc lượt khám không có phiếu thu), không phải lỗi.
      const cancelledInvoiceCount = await this.invoiceRepository.cancelUnpaidForEncounter(tx, tenantId, id, actorId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.cancelled',
        entityType: 'encounter',
        entityId: id,
        afterJson: { cancelReason: dto.cancelReason, fromStatus },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      if (cancelledInvoiceCount > 0) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'invoice.cancelled',
          entityType: 'encounter',
          entityId: id,
          afterJson: { status: 'CANCELLED', reason: 'encounter_cancelled' },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      const updated = await this.encounterRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return toEncounterSummary(updated);
    });
  }

  /**
   * #085 "Trả về hàng chờ" — `IN_CONSULTATION → CHECKED_IN`, nhả `doctorId` về `null` để lượt
   * khám quay lại hàng chờ chung Khoa ("Hàng đợi ảo" #064) cho bác sĩ khác nhận. Dùng khi bác sĩ
   * nhận nhầm ca của người khác hoặc bận đột xuất — KHÁC "Khách bỏ về": khách vẫn đang chờ khám,
   * không đóng ca, không đụng phiếu thu. `data_scope=personal` chỉ nhả được ca của chính mình.
   */
  async releaseEncounter(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: ReleaseEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      assertEncounterTransition(existing.status, 'CHECKED_IN');

      const count = await this.encounterRepository.release(tx, tenantId, id, dto.version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.released',
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
    const { history: historyWithDoctorId, ...rest } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
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
        doctorId: row.doctorId,
        chiefComplaint: row.chiefComplaint,
        primaryDiagnosisName: row.diagnoses[0]?.icd10.nameVi ?? null,
      }));

      const diagnosisRows = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);
      const diagnoses = diagnosisRows.map((row) => this.toDiagnosisItem(row));

      const noteRows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);

      // Kê đơn (Sprint 4) — dị nguyên đã biết của bệnh nhân (PRE-03) + đơn thuốc đang hiệu lực.
      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, encounter.patientId);
      const prescriptionRow = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      // Bệnh lý nền + thói quen/lối sống có cấu trúc (Sprint 5) — CHỈ XEM ở màn khám, sửa qua hồ sơ
      // bệnh nhân/Tiếp nhận (PatientHistoryDialog), cùng khuôn familyHistoryRows ngay dưới.
      const conditionRows = await this.patientConditionRepository.listForPatient(tx, tenantId, encounter.patientId);
      // Tiền sử gia đình có cấu trúc (Sprint 5) — CHỈ XEM ở màn khám (không còn textarea/autosave
      // riêng, xem docs/DECISIONS.md), sửa qua hồ sơ bệnh nhân/Tiếp nhận.
      const familyHistoryRows = await this.patientFamilyHistoryRepository.listForPatient(tx, tenantId, encounter.patientId);

      return {
        encounter: toEncounterSummary(encounter),
        patient: {
          id: encounter.patient.id,
          patientCode: encounter.patient.patientCode,
          fullName: encounter.patient.fullName,
          dob: encounter.patient.dob.toISOString().slice(0, 10),
          gender: encounter.patient.gender,
          phone: encounter.patient.phone,
          personalHistory: encounter.patient.personalHistory,
          allergens: allergenRows.map((a) => ({ id: a.allergenId, name: a.allergenName, allergenGroupName: a.allergenGroupName })),
          conditions: conditionRows.map((c) => ({ icd10Code: c.icd10Code, icd10Name: c.icd10Name })),
          familyHistoryRows: familyHistoryRows.map((f) => ({
            id: f.id,
            relation: f.relation,
            relationLabel: FAMILY_RELATION_LABELS[f.relation],
            icd10Code: f.icd10Code,
            icd10Name: f.icd10Name,
            ageOfOnsetYears: f.ageOfOnsetYears,
          })),
          version: encounter.patient.version,
        },
        vitalSigns,
        history,
        diagnoses,
        clinicalNote: this.toClinicalNoteResponse(noteRows),
        prescription: prescriptionRow ? this.toPrescriptionResponse(prescriptionRow, allergenRows.map((a) => a.allergenName)) : null,
      };
    });

    // Tên bác sĩ từng lượt khám cũ (panel tiền sử, yêu cầu chủ dự án) — `DoctorDirectoryPort` tự mở
    // transaction RIÊNG (cùng nguyên tắc `startConsultation()`), nên phải gọi NGOÀI transaction
    // chính ở trên để tránh `$transaction` lồng nhau.
    const doctorIds = [...new Set(historyWithDoctorId.map((h) => h.doctorId).filter((v): v is string => v !== null))];
    const doctorNames = doctorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, doctorIds) : new Map<string, string>();
    const history = historyWithDoctorId.map(({ doctorId, ...h }) => ({ ...h, doctorName: doctorId ? (doctorNames.get(doctorId) ?? null) : null }));

    return { ...rest, history };
  }

  /**
   * Thay thế toàn bộ danh sách chẩn đoán của lượt khám — `diagnosis.create` (`personal`, kế thừa
   * quyền sở hữu qua `encounter.doctorId` vì bảng `diagnosis` không có cột `doctorId` riêng, xem
   * `.claude/docs/security-audit.md`). `saveDiagnosesRequestSchema` (Zod) đã chặn phần lớn payload
   * sai (không có/nhiều hơn 1 PRIMARY) — kiểm lại ở đây là lớp phòng thủ thứ hai, không phải kiểm
   * dư thừa (service không tin tưởng input đã qua Zod là bất biến nghiệp vụ đúng tuyệt đối).
   *
   * **`status=COMPLETED` (đã ký, Sprint 5 S5-02/03) không còn sửa được qua đây** — thay thế cơ chế
   * "sửa tại chỗ" cũ (#066, khi `diagnosis` v1 chưa có khái niệm ký): `ClinicalRecordAlreadySignedError`
   * (409), chỉ dẫn dùng `POST .../diagnoses/amend` (đính chính, bắt buộc lý do).
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
      if (existing.status === 'COMPLETED') {
        throw new ClinicalRecordAlreadySignedError();
      }
      if (existing.status !== 'IN_CONSULTATION') {
        throw new EncounterNotInConsultationError();
      }
      const primaryCount = dto.diagnoses.filter((d) => d.type === 'PRIMARY').length;
      if (primaryCount !== 1) {
        throw new DiagnosisPrimaryRequiredError();
      }

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
        action: 'encounter.diagnosis_saved',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { items: rows.map((row) => this.toDiagnosisItem(row)) };
    });
  }

  /**
   * "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — CHỈ gọi được khi `status=COMPLETED` (đã ký, đúng
   * khuôn `amendPrescription()`: coi "chưa ký" là 404, không phải lỗi domain riêng). Đính chính là
   * hành động xác nhận trọn vẹn — bản mới ĐÃ KÝ NGAY, không qua lại bước nháp.
   */
  async amendDiagnoses(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: AmendDiagnosesRequest,
    meta: RequestMeta,
  ): Promise<SaveDiagnosesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId) || existing.status !== 'COMPLETED') {
        throw new NotFoundException();
      }

      const beforeRows = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);
      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'diagnosis', entityId: id });
      await this.diagnosisRepository.amendForEncounter(
        tx,
        tenantId,
        id,
        actorId,
        dto.diagnoses.map((d) => ({ icd10Code: d.icd10Code, type: d.type, note: d.note ?? null })),
        signature.signedAt,
        signature.signedBy,
        dto.amendmentReason,
      );
      const rows = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'diagnosis.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: beforeRows.map((r) => ({ icd10Code: r.icd10Code, type: r.type, note: r.note })) as unknown as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, diagnoses: dto.diagnoses } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { items: rows.map((row) => this.toDiagnosisItem(row)) };
    });
  }

  /**
   * Lưu cả 6 mục ghi chú lâm sàng trong một request (khớp form 1 lần bấm "Lưu" HOẶC autosave định
   * kỳ từ web). Bản nháp — `signedAt` null tới khi "Hoàn tất khám" (ký tự động, xem
   * `completeConsultation()`).
   *
   * **`status=COMPLETED` (đã ký, Sprint 5 S5-02/03) không còn sửa được qua đây** — thay thế cơ chế
   * "sửa tại chỗ" cũ (#066): `ClinicalRecordAlreadySignedError` (409), chỉ dẫn dùng
   * `POST .../clinical-note/amend` (đính chính, bắt buộc lý do).
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
      if (existing.status === 'COMPLETED') {
        throw new ClinicalRecordAlreadySignedError();
      }
      if (existing.status !== 'IN_CONSULTATION') {
        throw new EncounterNotInConsultationError();
      }

      const sections: { section: ClinicalNoteSection; input: SaveClinicalNoteRequest['reasonForVisit'] }[] = [
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
        action: 'encounter.clinical_note_saved',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toClinicalNoteResponse(rows);
    });
  }

  /**
   * "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — CHỈ gọi được khi `status=COMPLETED`. Khác
   * `amendDiagnoses()` (danh sách không "slot" cố định), mỗi section là 1-1 nên chỉ đính chính
   * ĐÚNG những section web gửi lên (đã tự tính diff) — section không đổi giữ nguyên bản đã ký.
   */
  async amendClinicalNote(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: AmendClinicalNoteRequest,
    meta: RequestMeta,
  ): Promise<ClinicalNoteResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId) || existing.status !== 'COMPLETED') {
        throw new NotFoundException();
      }

      const beforeRows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);
      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'clinical_note', entityId: id });
      for (const item of dto.sections) {
        const result = await this.clinicalNoteRepository.amendSection(
          tx,
          tenantId,
          id,
          item.section,
          item.content,
          item.version,
          actorId,
          signature.signedAt,
          signature.signedBy,
          dto.amendmentReason,
        );
        if (result === null) {
          throw new ConcurrentModificationError();
        }
      }
      const rows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'clinical_note.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: Object.fromEntries(beforeRows.map((r) => [r.section, r.content])) as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, sections: dto.sections } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toClinicalNoteResponse(rows);
    });
  }

  /**
   * "Hoàn tất khám" — `IN_CONSULTATION → COMPLETED`. Chỉ yêu cầu đúng một chẩn đoán chính
   * (.claude/docs/clinical-workflow.md) — KHÔNG phụ thuộc Kê đơn (module `prescription`, Sprint 4)
   * theo xác nhận của chủ dự án. Tái dùng permission `encounter.update` (đã dùng cho "bắt đầu
   * khám") — coi đây là một dạng chuyển trạng thái khác của cùng hành động, không thêm permission
   * mới.
   *
   * **Ký hồ sơ khám (Sprint 5, S5-02/03, ENC-04)** — TRONG CÙNG transaction, ký NGAY mọi `diagnosis`/
   * `clinical_note` đang hiệu lực (1 lần gọi `SignaturePort.sign()`, dùng chung `signedAt/signedBy`
   * cho cả hai — "Ký hồ sơ khám" là một hành động duy nhất, không tách theo bảng). Từ đây trở đi 2
   * bảng đó bất biến (trigger C8) — sửa phải qua đính chính (`amendDiagnoses()`/`amendClinicalNote()`).
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

      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'clinical_record', entityId: id });
      await this.diagnosisRepository.signAllForEncounter(tx, tenantId, id, actorId, signature.signedAt, signature.signedBy);
      await this.clinicalNoteRepository.signAllForEncounter(tx, tenantId, id, actorId, signature.signedAt, signature.signedBy);

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

  /**
   * Kê đơn (Sprint 4, S4-01/02) — thay thế TOÀN BỘ dòng thuốc của đơn NHÁP hiện tại (tạo đơn nháp
   * nếu chưa có). Cùng điều kiện trạng thái với `saveDiagnoses()`/`saveClinicalNote()`
   * (IN_CONSULTATION hoặc COMPLETED — cho sửa sau hoàn tất, đọc docstring 2 hàm đó). Bắt buộc đã có
   * chẩn đoán chính (.claude/docs/clinical-workflow.md: "Tạo được khi encounter IN_CONSULTATION và
   * đã có chẩn đoán chính") — `PrescriptionRequiresDiagnosisError` nếu chưa. Đơn ĐÃ KÝ không sửa
   * được qua đây (`PrescriptionAlreadySignedError` — lớp phòng thủ ở service, DB có trigger C8 chặn
   * cứng hơn; UI bình thường không cho bấm nút này sau khi ký, chỉ hiện "Sửa đơn"/`amendPrescription`).
   */
  async savePrescriptionItems(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SavePrescriptionItemsRequest,
    meta: RequestMeta,
  ): Promise<PrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const isPostCompletionEdit = existing.status === 'COMPLETED';
      if (existing.status !== 'IN_CONSULTATION' && !isPostCompletionEdit) {
        throw new EncounterNotInConsultationError();
      }

      const primaryCount = await this.diagnosisRepository.countPrimary(tx, tenantId, id);
      if (primaryCount !== 1) {
        throw new PrescriptionRequiresDiagnosisError();
      }

      let active = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      if (active && active.signedAt !== null) {
        throw new PrescriptionAlreadySignedError();
      }
      if (!active) {
        const created = await this.prescriptionRepository.createDraft(tx, tenantId, id, actorId);
        active = { ...created, items: [] };
      }

      await this.prescriptionRepository.replaceItems(tx, tenantId, active.id, actorId, dto.items.map((item) => this.toCreateItemData(item)));

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription.items_saved',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const updated = await this.prescriptionRepository.findById(tx, tenantId, active.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName));
    });
  }

  /**
   * Ký đơn NHÁP hiện tại — chữ ký logic qua `SignaturePort` (adapter no-op, xem .claude/docs/
   * security-audit.md). Bắt buộc ≥1 dòng thuốc (`PrescriptionEmptyError`). KHÔNG "chặn ký cứng" ở
   * v1 — đã hỏi và chốt với chủ dự án (2026-08-25): không có nguồn dữ liệu chống chỉ định/liều theo
   * tuổi (PRE-06 hoãn P2, `docs/DECISIONS.md` #072) nên PRE-02/03 chỉ là CẢNH BÁO MỀM, không chặn
   * ký; có cảnh báo mà bác sĩ vẫn ký thì ghi audit action riêng liệt kê cảnh báo đã bỏ qua.
   */
  async signPrescription(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SignPrescriptionRequest,
    meta: RequestMeta,
  ): Promise<PrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const isPostCompletionEdit = existing.status === 'COMPLETED';
      if (existing.status !== 'IN_CONSULTATION' && !isPostCompletionEdit) {
        throw new EncounterNotInConsultationError();
      }

      const active = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      if (!active || active.signedAt !== null) {
        throw new NotFoundException();
      }
      if (active.items.length === 0) {
        throw new PrescriptionEmptyError();
      }

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const allergenNames = allergenRows.map((a) => a.allergenName);
      const warnings = this.computeWarnings(active.items, allergenNames);

      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'prescription', entityId: active.id });
      const count = await this.prescriptionRepository.sign(tx, tenantId, active.id, dto.version, actorId, signature.signedAt, signature.signedBy);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: warnings.length > 0 ? 'prescription.signed_with_warnings' : 'prescription.signed',
        entityType: 'encounter',
        entityId: id,
        afterJson: warnings.length > 0 ? (warnings as unknown as Prisma.InputJsonValue) : undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.prescriptionRepository.findById(tx, tenantId, active.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenNames);
    });
  }

  /**
   * In đơn (PRE-04) — chỉ đơn ĐÃ KÝ mới in được (bố cục in nằm ở tầng web, đây chỉ ghi nhận
   * `printedAt`). Idempotent — in lại không lỗi, không đổi thời điểm in đầu tiên
   * (`markPrintedIfNotYet`).
   */
  async markPrescriptionPrinted(tenantId: string, actorId: string, dataScope: DataScope, id: string, meta: RequestMeta): Promise<PrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }

      const active = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      if (!active || active.signedAt === null) {
        throw new NotFoundException();
      }

      await this.prescriptionRepository.markPrintedIfNotYet(tx, tenantId, active.id, actorId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription.printed',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const updated = await this.prescriptionRepository.findById(tx, tenantId, active.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName));
    });
  }

  /**
   * Đính chính đơn ĐÃ KÝ (.claude/docs/clinical-workflow.md mục "Amendment hồ sơ") — tạo đơn MỚI
   * ĐÃ KÝ NGAY (đính chính là một hành động xác nhận trọn vẹn, không qua lại bước nháp),
   * `supersedesId` trỏ về đơn cũ, đơn cũ soft-delete (`deletedReason='amended'`). `items` là danh
   * sách ĐẦY ĐỦ của bản đính chính (không diff so với bản cũ, cùng khuôn `saveDiagnoses()`).
   */
  async amendPrescription(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: AmendPrescriptionRequest,
    meta: RequestMeta,
  ): Promise<PrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const isPostCompletionEdit = existing.status === 'COMPLETED';
      if (existing.status !== 'IN_CONSULTATION' && !isPostCompletionEdit) {
        throw new EncounterNotInConsultationError();
      }

      const active = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      if (!active || active.signedAt === null) {
        throw new NotFoundException();
      }
      if (dto.items.length === 0) {
        throw new PrescriptionEmptyError();
      }

      const supersedeCount = await this.prescriptionRepository.supersede(tx, tenantId, active.id, dto.version, actorId);
      if (supersedeCount === 0) {
        throw new ConcurrentModificationError();
      }

      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'prescription', entityId: active.id });
      const created = await this.prescriptionRepository.createAmendment(tx, tenantId, id, actorId, {
        supersedesId: active.id,
        amendmentReason: dto.amendmentReason,
        signedAt: signature.signedAt,
        signedBy: signature.signedBy,
      });
      await this.prescriptionRepository.createItems(tx, tenantId, created.id, actorId, dto.items.map((item) => this.toCreateItemData(item)));

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: active.items.map((i) => ({ drugId: i.drugId, dose: i.dose, quantity: i.quantity })) as unknown as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, items: dto.items } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const updated = await this.prescriptionRepository.findById(tx, tenantId, created.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName));
    });
  }

  private toCreateItemData(item: SavePrescriptionItemsRequest['items'][number]) {
    return {
      drugId: item.drugId,
      dose: item.dose,
      frequency: item.frequency,
      durationDays: item.durationDays,
      quantity: item.quantity,
      instruction: item.instruction ?? null,
    };
  }

  /** PRE-02 (trùng hoạt chất) + PRE-03 (đối chiếu dị nguyên đã biết) — CẢNH BÁO MỀM, không chặn ký (xem docstring `signPrescription`). */
  private computeWarnings(items: PrescriptionWithItems['items'], allergenNames: string[]): PrescriptionWarning[] {
    const lines: PrescriptionDrugLine[] = items.map((i) => ({ drugId: i.drugId, drugName: i.drugName, activeIngredient: i.activeIngredient }));
    const duplicates = findDuplicateActiveIngredients(lines).map(
      (d): PrescriptionWarning => ({ kind: 'duplicate_active_ingredient', label: d.activeIngredient, drugNames: d.drugNames }),
    );
    const allergies = findAllergyMatches(lines, allergenNames).map((a): PrescriptionWarning => ({ kind: 'allergy', label: a.allergenName, drugNames: a.drugNames }));
    return [...duplicates, ...allergies];
  }

  private toPrescriptionResponse(row: PrescriptionWithItems, allergenNames: string[]): PrescriptionDto {
    return {
      id: row.id,
      encounterId: row.encounterId,
      items: row.items.map((item) => this.toPrescriptionItem(item)),
      warnings: this.computeWarnings(row.items, allergenNames),
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      signedBy: row.signedBy,
      printedAt: row.printedAt ? row.printedAt.toISOString() : null,
      supersedesId: row.supersedesId,
      amendmentReason: row.amendmentReason,
      version: row.version,
    };
  }

  private toPrescriptionItem(item: PrescriptionWithItems['items'][number]): PrescriptionItemDto {
    return {
      id: item.id,
      drugId: item.drugId,
      drugName: item.drugName,
      activeIngredient: item.activeIngredient,
      dose: item.dose,
      frequency: item.frequency,
      durationDays: item.durationDays,
      quantity: item.quantity,
      instruction: item.instruction,
    };
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
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      signedBy: row.signedBy,
      supersedesId: row.supersedesId,
      amendmentReason: row.amendmentReason,
      version: row.version,
    };
  }

  private toClinicalNoteResponse(rows: ClinicalNote[]): ClinicalNoteResponse {
    const bySection = new Map(
      rows.map((row) => [
        row.section,
        {
          content: row.content,
          version: row.version,
          signedAt: row.signedAt ? row.signedAt.toISOString() : null,
          signedBy: row.signedBy,
          supersedesId: row.supersedesId,
          amendmentReason: row.amendmentReason,
        },
      ]),
    );
    return {
      reasonForVisit: bySection.get('REASON_FOR_VISIT') ?? null,
      illnessProgress: bySection.get('ILLNESS_PROGRESS') ?? null,
      preliminaryDiagnosis: bySection.get('PRELIMINARY_DIAGNOSIS') ?? null,
      generalExam: bySection.get('GENERAL_EXAM') ?? null,
      regionalExam: bySection.get('REGIONAL_EXAM') ?? null,
      plan: bySection.get('PLAN') ?? null,
    };
  }
}
