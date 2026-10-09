import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  ClinicalRecordAlreadySignedError,
  ConcurrentModificationError,
  DiagnosisPrimaryRequiredError,
  DOCTOR_DIRECTORY_PORT,
  EncounterAlreadyClaimedError,
  EncounterNotInConsultationError,
  EncounterNotReassignableError,
  EncounterPaymentRequiredError,
  FollowUpDateInvalidError,
  CLINICAL_ORDER_CANCELLATION_PORT,
  PARACLINICAL_RESULTS_READER_PORT,
  PDF_RENDERER_PORT,
  PrescriptionAlreadySignedError,
  PrescriptionEmptyError,
  PrescriptionFreeTextDisabledError,
  PrescriptionRequiresDiagnosisError,
  PrescriptionStockInsufficientError,
  renderPatientMedicalRecordHtml,
  type MedicalRecordPrintOptions,
  SIGNATURE_PORT,
  STOCK_AVAILABILITY_PORT,
  assertEncounterTransition,
  evaluateVitalSignWarnings,
  findAllergyMatches,
  findDuplicateActiveIngredients,
  findInsufficientStock,
  formatDateStringVi,
  getVietnamDateString,
  resolveFollowUpFromDate,
  vietnameseWeekdayLabel,
  resolveDoctorDepartmentRouting,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type MedicalRecordEncounterEntry,
  type PatientMedicalRecordDocument,
  type ClinicalOrderCancellationPort,
  type ParaclinicalResultsReaderPort,
  type PdfRendererPort,
  type PrescriptionDrugLine,
  type SignaturePort,
  type StockAvailabilityPort,
} from '@nexamed/core';
import { FAMILY_RELATION_LABELS, TREATMENT_DIRECTION_LABELS, calculateAgeYears, computePrescriptionQuantity, formatDoseSummary } from '@nexamed/shared';
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
  PatientClinicalSummaryResponse,
  PatientVitalSignHistoryItem,
  PreviousPrescriptionResponse,
  PrescriptionResponse,
  PrescriptionWarning,
  ReassignEncounterRequest,
  ReleaseEncounterRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  SavePrescriptionItemsRequest,
  SignPrescriptionRequest,
  StartConsultationRequest,
  TreatmentPlanInput,
  VitalSignResponse,
} from '@nexamed/shared';
import type { ClinicalNote, EncounterTreatmentPlan, Prisma, VitalSign } from '@prisma/client';
import { PrintTemplateService } from '../print-template/print-template.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DiagnosisSuggestionService } from './diagnosis-suggestion.service';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository, type DiagnosisWithIcd10Name } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { TreatmentPlanRepository, dbDateToDateString } from './treatment-plan.repository';
import { PrescriptionRepository, type PrescriptionWithItems } from './prescription.repository';
import { toEncounterSummary } from './encounter.mapper';
import { PatientAllergenRepository } from '../patient/patient-allergen.repository';
import { PatientConditionRepository } from '../patient/patient-condition.repository';
import { PatientFamilyHistoryRepository } from '../patient/patient-family-history.repository';
import { PatientService } from '../patient/patient.service';
import { InvoiceRepository } from '../billing/invoice.repository';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { BusinessCodeService } from '../clinic/business-code.service';
import { GeoRepository } from '../geo/geo.repository';

const TEMPERATURE_DECI_PER_CELSIUS = 10;
/** Số lần khám cũ tối đa hiện trong panel tiền sử (ENC-01) — danh sách tóm tắt, không phân trang ở v1. */
const CONSULTATION_HISTORY_LIMIT = 20;
/** Số dòng sinh hiệu gần nhất hiện ở trang "Hồ sơ bệnh nhân" (dải KPI + bảng). */
const PATIENT_VITALS_HISTORY_LIMIT = 5;
/** "Xuất bệnh án PDF" (S6-06) — nhãn tiếng Việt 6 mục SOAP theo đúng thứ tự hiển thị màn khám. Lặp
 * lại nhỏ so với `CLINICAL_SECTION_LABEL` (`apps/web/.../clinical-display.tsx`) — không trích xuất
 * dùng chung, xem comment đầu `render-patient-medical-record-html.ts`. */
const CLINICAL_NOTE_SECTION_LABELS: [Exclude<keyof ClinicalNoteResponse, 'treatmentPlan'>, string][] = [
  ['reasonForVisit', 'Lý do khám'],
  ['illnessProgress', 'Quá trình bệnh lý'],
  ['preliminaryDiagnosis', 'Chẩn đoán'],
  ['generalExam', 'Kết quả khám toàn thân'],
  ['regionalExam', 'Kết quả khám bộ phận'],
  ['conclusion', 'Kết luận'],
];
/** Nhãn giới tính — lặp lại nhỏ so với `GENDER_LABEL` (`apps/web/.../patient-form.utils.ts`), cùng lý do trên. */
const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };

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
    private readonly treatmentPlanRepository: TreatmentPlanRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly patientAllergenRepository: PatientAllergenRepository,
    private readonly patientConditionRepository: PatientConditionRepository,
    private readonly patientFamilyHistoryRepository: PatientFamilyHistoryRepository,
    private readonly patientService: PatientService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly clinicProfileService: ClinicProfileService,
    private readonly businessCodeService: BusinessCodeService,
    private readonly geoRepository: GeoRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(SIGNATURE_PORT) private readonly signaturePort: SignaturePort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(PDF_RENDERER_PORT) private readonly pdfRenderer: PdfRendererPort,
    @Inject(STOCK_AVAILABILITY_PORT) private readonly stockAvailability: StockAvailabilityPort,
    @Inject(PARACLINICAL_RESULTS_READER_PORT) private readonly paraclinicalResultsReader: ParaclinicalResultsReaderPort,
    @Inject(CLINICAL_ORDER_CANCELLATION_PORT) private readonly clinicalOrderCancellation: ClinicalOrderCancellationPort,
    private readonly diagnosisSuggestionService: DiagnosisSuggestionService,
    private readonly printTemplateService: PrintTemplateService,
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
      // #219 — đóng dòng chỉ định cận lâm sàng CHƯA BẮT ĐẦU (cùng transaction). Dòng đang làm dở/đã duyệt giữ nguyên; hoá đơn đã thu đi theo luồng hoàn tiền.
      const cancelledOrderItemCount = await this.clinicalOrderCancellation.cancelNotStartedItems(tx, tenantId, id, actorId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.cancelled',
        entityType: 'encounter',
        entityId: id,
        afterJson: { cancelReason: dto.cancelReason, fromStatus, ...(cancelledOrderItemCount > 0 ? { cancelledOrderItemCount } : {}) },
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
   * "Trung tâm Điều phối Tiếp nhận" — lễ tân chủ động đổi bác sĩ/Khoa phụ trách một lượt khám còn
   * `CHECKED_IN` (đã hỏi và chốt: KHÔNG áp dụng cho `IN_CONSULTATION`, tránh đụng ca đang khám dở
   * — 409 `ENCOUNTER_NOT_REASSIGNABLE` cho mọi trạng thái khác). Tái dùng đúng
   * `resolveDoctorDepartmentRouting()` đã trích xuất từ `ReceptionService.resolveRouting()` (dùng
   * lần 2, CLAUDE.md) — "đích danh bác sĩ" server tự suy Khoa, "theo Khoa" giữ `doctorId=null`.
   */
  async reassignEncounter(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: ReassignEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    // `DoctorDirectoryPort` tự mở transaction RIÊNG — resolve TRƯỚC transaction chính, cùng lý do
    // đã áp dụng ở `ReceptionService.checkIn()`/`registerDirect()`.
    const routing = await resolveDoctorDepartmentRouting(this.doctorDirectory, tenantId, dto);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (existing.status !== 'CHECKED_IN') {
        throw new EncounterNotReassignableError();
      }

      const count = await this.encounterRepository.reassign(tx, tenantId, id, routing.doctorId, routing.departmentId, dto.version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.reassigned',
        entityType: 'encounter',
        entityId: id,
        beforeJson: { doctorId: existing.doctorId, departmentId: existing.departmentId },
        afterJson: { doctorId: routing.doctorId, departmentId: routing.departmentId },
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
    // Kho Thuốc GĐ5 — đọc cấu hình + tồn kho TRƯỚC transaction chính, cùng nguyên tắc `signPrescription()`
    // (`ClinicConfigReaderPort`/`StockAvailabilityPort` tự mở transaction riêng, không lồng được).
    // Bug thật phát hiện lúc verify Playwright: thiếu đúng đoạn này khiến cảnh báo `stock_insufficient`
    // trả về ĐÚNG ở response `PUT .../prescription-items` nhưng biến mất ngay sau khi trang tự
    // `invalidateQueries` refetch lại `GET .../consultation` (route NÀY, trước đó gọi
    // `toPrescriptionResponse()` không truyền `onHandByDrugId` nên luôn mặc định `null` = không tính
    // cảnh báo tồn kho) — cảnh báo chỉ kịp hiện trong khoảnh khắc trước khi bị ghi đè bởi dữ liệu vừa
    // refetch, coi như KHÔNG BAO GIỜ hiển thị được cho bác sĩ trong thực tế. Chỉ tính cho đơn CHƯA KÝ
    // (đơn đã ký xem như "đã xong", giữ nguyên `null` — đúng khuôn PrescriptionPrintView/lịch sử).
    const pharmacyStockTrackingEnabled = await this.clinicConfigReader.getPharmacyStockTrackingEnabled(tenantId);
    let onHandByDrugId: Record<string, number> | null = null;
    if (pharmacyStockTrackingEnabled) {
      const draftPreview = await this.unitOfWork.runInTenantScope(tenantId, (previewTx) =>
        this.prescriptionRepository.findActiveForEncounter(previewTx, tenantId, id),
      );
      if (draftPreview && draftPreview.signedAt === null && draftPreview.items.length > 0) {
        // Dòng "kê thuốc tự do" (`drugId=null`) không có khái niệm tồn kho — lọc bỏ trước khi tra.
        const realDrugIds = draftPreview.items.map((i) => i.drugId).filter((v): v is string => v !== null);
        onHandByDrugId = await this.stockAvailability.getOnHandQuantities(tenantId, [...new Set(realDrugIds)]);
      }
    }

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
      const treatmentPlanRow = await this.treatmentPlanRepository.findActive(tx, tenantId, id);

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
        clinicalNote: this.toClinicalNoteResponse(noteRows, treatmentPlanRow),
        prescription: prescriptionRow ? this.toPrescriptionResponse(prescriptionRow, allergenRows.map((a) => a.allergenName), onHandByDrugId) : null,
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
   * Trang "Hồ sơ bệnh nhân" (dải KPI + bảng "Sinh hiệu theo lượt khám") — gate bằng `patient.read`
   * ở controller (global cho mọi vai trò), CỐ Ý không nhận `dataScope`/`actorId`: xem đầy đủ mọi
   * bác sĩ, không giới hạn `personal` như `encounter.read` ở nơi khác (đã chốt qua `AskUserQuestion`
   * — liên tục chăm sóc, cùng lý do "Lịch sử khám" sẽ hiện đủ mọi bác sĩ).
   */
  async getPatientClinicalSummary(tenantId: string, patientId: string): Promise<PatientClinicalSummaryResponse> {
    const summary = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.encounterRepository.findPatientClinicalSummary(tx, tenantId, patientId, PATIENT_VITALS_HISTORY_LIMIT),
    );
    return {
      totalCompletedVisits: summary.totalCompletedVisits,
      lastCompletedVisitAt: summary.lastCompletedVisitAt?.toISOString() ?? null,
      recentVitalSigns: summary.vitalSigns.map((v) => this.toPatientVitalSignHistoryItem(v)),
    };
  }

  /**
   * "Xuất bệnh án PDF" (S6-06, ADM-05) — gộp thông tin hành chính + tiền sử (qua `PatientService.
   * getPatient()`, đã giải mã CCCD sẵn) + TOÀN BỘ lượt khám `COMPLETED` (không cap, khác panel tiền
   * sử màn khám) thành 1 chuỗi HTML (`renderPatientMedicalRecordHtml()`, `packages/core`, thuần) rồi
   * đưa qua `PdfRendererPort` (Puppeteer/Chromium) ra buffer PDF thật. Gate quyền
   * `patient.export_medical_record` ở controller — KHÁC `patient.read` (chỉ xem KPI/tiền sử tóm
   * tắt), vì bản PDF chứa TRỌN VẸN nội dung đã ký (SOAP/chẩn đoán/đơn thuốc).
   */
  async exportMedicalRecordPdf(tenantId: string, patientId: string, reason: string): Promise<{ pdf: Buffer; patientCode: string; encounterCount: number }> {
    // Ngoài transaction chính — cùng lý do `doctorDirectory.getUserFullNames()` ở `getConsultationDetail()`
    // (mỗi port/service tự mở transaction riêng, tránh `$transaction` lồng nhau).
    const patient = await this.patientService.getPatient(tenantId, patientId);
    const clinicHeader = await this.clinicProfileService.getPrintHeader(tenantId);

    const provinceCode = patient.address?.province;
    const wardCode = patient.address?.ward;
    const { provinces, wards, encounterRows, diagnosesByEncounter, notesByEncounter, treatmentPlanByEncounter, prescriptionByEncounter, vitalsByEncounter } =
      await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
        const [provinces, wards, encounterRows] = await Promise.all([
          this.geoRepository.findProvincesByCodes(tx, provinceCode ? [provinceCode] : []),
          this.geoRepository.findWardsByCodes(tx, wardCode ? [wardCode] : []),
          this.encounterRepository.listAllCompletedForPatient(tx, tenantId, patientId),
        ]);
        const encounterIds = encounterRows.map((e) => e.id);
        const [diagnosesByEncounter, notesByEncounter, treatmentPlanByEncounter, prescriptionByEncounter, vitalsByEncounter] = await Promise.all([
          this.diagnosisRepository.listForEncounters(tx, tenantId, encounterIds),
          this.clinicalNoteRepository.listForEncounters(tx, tenantId, encounterIds),
          this.treatmentPlanRepository.findActiveForEncounters(tx, tenantId, encounterIds),
          this.prescriptionRepository.findActiveForEncounters(tx, tenantId, encounterIds),
          this.encounterRepository.listLatestVitalSignsForEncounters(tx, tenantId, encounterIds),
        ]);
        return { provinces, wards, encounterRows, diagnosesByEncounter, notesByEncounter, treatmentPlanByEncounter, prescriptionByEncounter, vitalsByEncounter };
      });
    const addressLine =
      [patient.address?.street, patient.address?.neighborhood, wards[0]?.name ?? wardCode, provinces[0]?.name ?? provinceCode].filter(Boolean).join(', ') || null;

    const doctorIds = [...new Set(encounterRows.map((e) => e.doctorId).filter((v): v is string => v !== null))];
    const doctorNames = doctorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, doctorIds) : new Map<string, string>();
    // Kết quả cận lâm sàng ĐÃ DUYỆT của từng lượt khám — qua port (không import module `paraclinical-result`), mỗi lần tự mở transaction riêng như `doctorDirectory`.
    const paraclinicalByEncounter = await this.paraclinicalResultsReader.listSignedForEncounters(
      tenantId,
      encounterRows.map((e) => e.id),
    );

    const encounters: MedicalRecordEncounterEntry[] = encounterRows.map((e) => {
      const noteRows = notesByEncounter.get(e.id) ?? [];
      const planRow = treatmentPlanByEncounter.get(e.id) ?? null;
      const noteResponse = this.toClinicalNoteResponse(noteRows, planRow);
      const prescriptionRow = prescriptionByEncounter.get(e.id);
      const vitalSign = vitalsByEncounter.get(e.id);
      return {
        encounterNo: e.encounterNo,
        checkedInAt: e.checkedInAt.toISOString(),
        doctorName: e.doctorId ? (doctorNames.get(e.doctorId) ?? null) : null,
        chiefComplaint: e.chiefComplaint,
        vitalSigns: vitalSign
          ? {
              measuredAt: vitalSign.measuredAt.toISOString(),
              pulse: vitalSign.pulse,
              temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : null,
              bpSystolic: vitalSign.bpSystolic,
              bpDiastolic: vitalSign.bpDiastolic,
              respiratoryRate: vitalSign.respiratoryRate,
              spo2: vitalSign.spo2,
              weightGram: vitalSign.weightGram,
              heightMm: vitalSign.heightMm,
            }
          : null,
        diagnoses: (diagnosesByEncounter.get(e.id) ?? []).map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10.nameVi, type: d.type, note: d.note })),
        clinicalNoteSections: CLINICAL_NOTE_SECTION_LABELS.map(([key, label]) => ({ label, content: noteResponse[key]?.content ?? '' })),
        treatment: this.toMedicalRecordTreatment(noteResponse),
        paraclinicalResults: paraclinicalByEncounter[e.id] ?? [],
        prescriptionItems: (prescriptionRow?.items ?? []).map((i) => ({
          drugName: i.drugName,
          doseSummary: formatDoseSummary(i),
          durationDays: i.durationDays,
          quantity: i.quantity,
          unitCode: i.unitCode,
          instruction: i.instruction,
        })),
        signedAt: prescriptionRow?.signedAt ? prescriptionRow.signedAt.toISOString() : (noteRows[0]?.signedAt?.toISOString() ?? null),
      };
    });

    const document: PatientMedicalRecordDocument = {
      clinic: { name: clinicHeader.name, address: clinicHeader.address, phone: clinicHeader.phone, taxCode: clinicHeader.taxCode },
      patient: {
        patientCode: patient.patientCode,
        fullName: patient.fullName,
        dob: patient.dob,
        genderLabel: GENDER_LABEL[patient.gender] ?? patient.gender,
        phone: patient.phone,
        address: addressLine,
        nationalId: patient.nationalId,
        occupation: patient.occupation,
        ethnicity: patient.ethnicity,
        nationality: patient.nationality,
        personalHistory: patient.personalHistory,
        allergenNames: patient.allergens.map((a) => a.name),
        conditionNames: patient.conditions.map((c) => c.icd10Name),
        familyHistoryLines: patient.familyHistoryRows.map(
          (f) => `${f.relationLabel}: ${f.icd10Name}${f.ageOfOnsetYears != null ? ` (${f.ageOfOnsetYears} tuổi)` : ''}`,
        ),
      },
      encounters,
      generatedAt: new Date().toISOString(),
      reason,
    };

    // Bản mẫu in `MEDICAL_RECORD` ("Quản lý mẫu in", #211): đầu trang/tiêu đề/ghi chú cuối/lề do phòng khám cấu hình;
    // chưa cấu hình thì dùng bản dựng sẵn (cùng bố cục cũ).
    const template = await this.printTemplateService.resolveOne(tenantId, 'MEDICAL_RECORD');
    const { header, margins } = template.config;
    const printOptions: MedicalRecordPrintOptions = {
      header: { showClinicName: header.showClinicName, showAddress: header.showAddress, showPhone: header.showPhone, showTaxCode: header.showTaxCode, showDivider: header.showDivider },
      title: template.config.title.text.trim() || null,
      footerNote: template.config.footer.note.trim() || null,
    };
    const html = renderPatientMedicalRecordHtml(document, printOptions);
    const pdf = await this.pdfRenderer.renderHtmlToPdf(html, { marginsMm: { top: margins.topMm, right: margins.rightMm, bottom: margins.bottomMm, left: margins.leftMm } });
    return { pdf, patientCode: patient.patientCode, encounterCount: encounters.length };
  }

  /**
   * Ghi audit cho "Xuất bệnh án PDF" (S6-06) — TÁCH khỏi `exportMedicalRecordPdf()` để controller
   * tự quyết định gọi sau khi render THÀNH CÔNG (không ghi audit cho lần render lỗi giữa chừng).
   * Bắt buộc có `reason` — `.claude/docs/security-audit.md`: "Export dữ liệu ghi audit kèm phạm vi
   * bản ghi và lý do export" (khác các export Excel #142 không thu thập lý do vì UI khi đó không
   * có ô nhập nào).
   */
  async recordMedicalRecordExportAudit(tenantId: string, actorId: string, patientId: string, reason: string, encounterCount: number, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'patient.medical_record_exported',
        entityType: 'patient',
        entityId: patientId,
        afterJson: { reason, encounterCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
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
      // Danh sách rỗng hợp lệ ở bước nháp (bác sĩ gỡ hết mã) — "Hoàn tất khám" mới bắt buộc đúng 1 PRIMARY.
      const primaryCount = dto.diagnoses.filter((d) => d.type === 'PRIMARY').length;
      if (dto.diagnoses.length > 0 && primaryCount !== 1) {
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
    // "Học từ lịch sử chọn mã" (#206) — đọc cấu hình TRƯỚC khi mở transaction (`ClinicConfigReaderPort` tự mở transaction riêng), cùng khuôn `completeConsultation()`.
    const learnedPairs = dto.learnedPairs ?? [];
    const learningEnabled =
      learnedPairs.length > 0 &&
      (await this.clinicConfigReader.getIcd10SuggestionEnabled(tenantId)) &&
      (await this.clinicConfigReader.getIcd10SuggestionLearningEnabled(tenantId));
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

      if (learningEnabled) {
        await this.diagnosisSuggestionService.recordLearnedPairs(
          tx,
          tenantId,
          actorId,
          dto.diagnoses.map((d) => d.icd10Code),
          learnedPairs,
        );
      }

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
      // #222 — Kết luận + Lời dặn: tuỳ chọn trong request (client cũ không gửi thì giữ nguyên).
      if (dto.conclusion) sections.push({ section: 'CONCLUSION', input: dto.conclusion });
      if (dto.doctorAdvice) sections.push({ section: 'DOCTOR_ADVICE', input: dto.doctorAdvice });
      for (const { section, input } of sections) {
        const result = await this.clinicalNoteRepository.upsertSection(tx, tenantId, id, section, input.content, input.version, actorId);
        if (result === 0) {
          throw new ConcurrentModificationError();
        }
      }

      if (dto.treatmentPlan) {
        this.assertFollowUpValid(existing.checkedInAt, dto.treatmentPlan);
        const result = await this.treatmentPlanRepository.upsert(
          tx,
          tenantId,
          id,
          { directions: dto.treatmentPlan.directions, followUpDate: dto.treatmentPlan.followUpDate },
          dto.treatmentPlan.version,
          actorId,
        );
        if (result === 0) {
          throw new ConcurrentModificationError();
        }
      }

      const rows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);
      const planRow = await this.treatmentPlanRepository.findActive(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.clinical_note_saved',
        entityType: 'encounter',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toClinicalNoteResponse(rows, planRow);
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
      const beforePlan = await this.treatmentPlanRepository.findActive(tx, tenantId, id);
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
      if (dto.treatmentPlan) {
        this.assertFollowUpValid(existing.checkedInAt, dto.treatmentPlan);
        const unchanged =
          beforePlan !== null &&
          beforePlan.directions.length === dto.treatmentPlan.directions.length &&
          beforePlan.directions.every((d) => dto.treatmentPlan!.directions.includes(d)) &&
          dbDateToDateString(beforePlan.followUpDate) === dto.treatmentPlan.followUpDate;
        // Không đổi gì thì giữ nguyên bản đã ký (không tạo lịch sử vô ích) — đúng khuôn từng mục ghi chú.
        if (!unchanged) {
          const amended = await this.treatmentPlanRepository.amend(
            tx,
            tenantId,
            id,
            { directions: dto.treatmentPlan.directions, followUpDate: dto.treatmentPlan.followUpDate },
            dto.treatmentPlan.version,
            actorId,
            signature.signedAt,
            signature.signedBy,
            dto.amendmentReason,
          );
          if (amended === null) {
            throw new ConcurrentModificationError();
          }
        }
      }
      const rows = await this.clinicalNoteRepository.listForEncounter(tx, tenantId, id);
      const planRow = await this.treatmentPlanRepository.findActive(tx, tenantId, id);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'clinical_note.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: {
          ...Object.fromEntries(beforeRows.map((r) => [r.section, r.content])),
          ...(beforePlan ? { treatmentPlan: { directions: beforePlan.directions, followUpDate: dbDateToDateString(beforePlan.followUpDate) } } : {}),
        } as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, sections: dto.sections, treatmentPlan: dto.treatmentPlan ?? null } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toClinicalNoteResponse(rows, planRow);
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
    // "Học từ lịch sử chọn mã" — đọc cấu hình TRƯỚC khi mở transaction (`ClinicConfigReaderPort` tự mở transaction riêng). Chỉ đọc khi client gửi `learnedPairs`.
    const learnedPairs = dto.learnedPairs ?? [];
    const learningEnabled =
      learnedPairs.length > 0 &&
      (await this.clinicConfigReader.getIcd10SuggestionEnabled(tenantId)) &&
      (await this.clinicConfigReader.getIcd10SuggestionLearningEnabled(tenantId));
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
      await this.treatmentPlanRepository.signAllForEncounter(tx, tenantId, id, actorId, signature.signedAt, signature.signedBy);

      if (learningEnabled) {
        const finalDiagnoses = await this.diagnosisRepository.listForEncounter(tx, tenantId, id);
        await this.diagnosisSuggestionService.recordLearnedPairs(
          tx,
          tenantId,
          actorId,
          finalDiagnoses.map((d) => d.icd10Code),
          learnedPairs,
        );
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
    // Kho Thuốc GĐ5 — đọc tồn kho TRƯỚC transaction chính (`ClinicConfigReaderPort`/
    // `StockAvailabilityPort` tự mở transaction riêng, không lồng được — cùng nguyên tắc
    // `DoctorDirectoryPort` ở `startConsultation()`). `dto.items` đã có sẵn `drugId` ngay trong
    // request, không cần đọc DB trước như `signPrescription()`.
    const pharmacyStockTrackingEnabled = await this.clinicConfigReader.getPharmacyStockTrackingEnabled(tenantId);
    // "Kê thuốc tự do" — đọc TRƯỚC transaction chính, cùng lý do `pharmacyStockTrackingEnabled`.
    const allowFreeTextPrescriptionEnabled = await this.clinicConfigReader.getAllowFreeTextPrescriptionEnabled(tenantId);
    this.assertFreeTextAllowed(dto.items, allowFreeTextPrescriptionEnabled);
    // `null` = KHÔNG tính cảnh báo tồn kho (khác `{}` — nghĩa là "đã tra, xác nhận tồn = 0" cho MỌI
    // thuốc, sẽ báo vượt tồn SAI cho mọi dòng khi tenant tắt tính năng này). Lọc bỏ dòng tự do
    // (`drugId=undefined`) — không có khái niệm tồn kho.
    const realDrugIds = [...new Set(dto.items.map((i) => i.drugId).filter((v): v is string => v !== undefined))];
    const onHandByDrugId: Record<string, number> | null = pharmacyStockTrackingEnabled
      ? await this.stockAvailability.getOnHandQuantities(tenantId, realDrugIds)
      : null;

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
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName), onHandByDrugId);
    });
  }

  /**
   * Ký đơn NHÁP hiện tại — chữ ký logic qua `SignaturePort` (adapter no-op, xem .claude/docs/
   * security-audit.md). Bắt buộc ≥1 dòng thuốc (`PrescriptionEmptyError`). KHÔNG "chặn ký cứng" cho
   * PRE-02/03 — đã hỏi và chốt với chủ dự án (2026-08-25): không có nguồn dữ liệu chống chỉ định/
   * liều theo tuổi (PRE-06 hoãn P2, `docs/DECISIONS.md` #072) nên 2 cảnh báo đó CHỈ MỀM, không chặn
   * ký; có cảnh báo mà bác sĩ vẫn ký thì ghi audit action riêng liệt kê cảnh báo đã bỏ qua. Kho
   * Thuốc GĐ5: "kê vượt tồn" (`stock_insufficient`) MẶC ĐỊNH cũng chỉ cảnh báo mềm như trên, NHƯNG
   * chặn CỨNG (`PrescriptionStockInsufficientError`, 422) khi tenant bật
   * `prescriptionStockBlockEnabled` — đã chốt qua AskUserQuestion, khác PRE-02/03 vì "đủ tồn để
   * phát thuốc" là điều kiện vận hành có thể kiểm chứng khách quan, không phải phán đoán lâm sàng.
   */
  async signPrescription(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SignPrescriptionRequest,
    meta: RequestMeta,
  ): Promise<PrescriptionResponse> {
    // Kho Thuốc GĐ5 — đọc cấu hình + tồn kho TRƯỚC transaction chính (`ClinicConfigReaderPort`/
    // `StockAvailabilityPort` tự mở transaction riêng, không lồng được — cùng nguyên tắc
    // `DoctorDirectoryPort` ở `startConsultation()`). Đọc trước NGUYÊN VẸN đơn nháp hiện tại chỉ để
    // biết danh sách `drugId` cần tra tồn (khác `savePrescriptionItems`/`amendPrescription`, dto ở
    // đây chỉ có `version`, không có `items`) — bản CHÍNH THỨC đọc lại trong transaction bên dưới
    // trước khi ký, không có TOCTOU thật (tồn kho lệch nhẹ giữa 2 lần đọc chỉ ảnh hưởng độ chính
    // xác của cảnh báo/chặn, không ảnh hưởng tính đúng đắn của việc ký đơn).
    const pharmacyStockTrackingEnabled = await this.clinicConfigReader.getPharmacyStockTrackingEnabled(tenantId);
    // `null` = KHÔNG tính cảnh báo/chặn tồn kho (khác `{}` — nghĩa là "đã tra, xác nhận tồn = 0" cho
    // MỌI thuốc, sẽ chặn/báo SAI cho mọi dòng khi tenant tắt tính năng này).
    let onHandByDrugId: Record<string, number> | null = null;
    if (pharmacyStockTrackingEnabled) {
      const draftPreview = await this.unitOfWork.runInTenantScope(tenantId, (previewTx) =>
        this.prescriptionRepository.findActiveForEncounter(previewTx, tenantId, id),
      );
      if (draftPreview) {
        // Dòng "kê thuốc tự do" (`drugId=null`) không có khái niệm tồn kho — lọc bỏ trước khi tra.
        const realDrugIds = draftPreview.items.map((i) => i.drugId).filter((v): v is string => v !== null);
        onHandByDrugId = await this.stockAvailability.getOnHandQuantities(tenantId, [...new Set(realDrugIds)]);
      }
    }
    const prescriptionStockBlockEnabled = pharmacyStockTrackingEnabled && (await this.clinicConfigReader.getPrescriptionStockBlockEnabled(tenantId));

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

      if (prescriptionStockBlockEnabled && onHandByDrugId !== null) {
        const shortages = findInsufficientStock(
          active.items
            .filter((i): i is PrescriptionWithItems['items'][number] & { drugId: string } => i.drugId !== null)
            .map((i) => ({ drugId: i.drugId, drugName: i.drugName, quantity: i.quantity })),
          onHandByDrugId,
        );
        if (shortages.length > 0) {
          throw new PrescriptionStockInsufficientError(shortages);
        }
      }

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const allergenNames = allergenRows.map((a) => a.allergenName);
      const warnings = this.computeWarnings(active.items, allergenNames, onHandByDrugId);

      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'prescription', entityId: active.id });
      const prescriptionNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'PRESCRIPTION', signature.signedAt);
      const count = await this.prescriptionRepository.sign(tx, tenantId, active.id, dto.version, actorId, signature.signedAt, signature.signedBy, prescriptionNo);
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
      return this.toPrescriptionResponse(updated, allergenNames, onHandByDrugId);
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
    // Kho Thuốc GĐ5 — cùng lý do đọc TRƯỚC transaction chính ở `savePrescriptionItems()`. `null` =
    // KHÔNG tính cảnh báo tồn kho (khác `{}` — xem comment ở `savePrescriptionItems`).
    const pharmacyStockTrackingEnabled = await this.clinicConfigReader.getPharmacyStockTrackingEnabled(tenantId);
    // "Kê thuốc tự do" — cùng lý do đọc TRƯỚC transaction chính ở `savePrescriptionItems()`.
    const allowFreeTextPrescriptionEnabled = await this.clinicConfigReader.getAllowFreeTextPrescriptionEnabled(tenantId);
    this.assertFreeTextAllowed(dto.items, allowFreeTextPrescriptionEnabled);
    const realDrugIds = [...new Set(dto.items.map((i) => i.drugId).filter((v): v is string => v !== undefined))];
    const onHandByDrugId: Record<string, number> | null = pharmacyStockTrackingEnabled
      ? await this.stockAvailability.getOnHandQuantities(tenantId, realDrugIds)
      : null;

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
        // Giữ nguyên mã đơn gốc (#169, chốt qua AskUserQuestion) — không gọi businessCodeService.generate() ở đây.
        prescriptionNo: active.prescriptionNo,
      });
      await this.prescriptionRepository.createItems(tx, tenantId, created.id, actorId, dto.items.map((item) => this.toCreateItemData(item)));

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: active.items.map((i) => ({ drugId: i.drugId, doseSummary: formatDoseSummary(i), quantity: i.quantity })) as unknown as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, items: dto.items } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const updated = await this.prescriptionRepository.findById(tx, tenantId, created.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName), onHandByDrugId);
    });
  }

  /** "Sao chép đơn thuốc lần khám trước" (docs/DECISIONS.md #196, mockup đã duyệt) — đơn ĐÃ KÝ gần
   * nhất của CÙNG bệnh nhân, ở lượt khám KHÁC lượt khám này. `null` nếu chưa từng có đơn nào trước
   * đó. Web chèn cả cụm vào đơn đang kê rồi bác sĩ tự sửa/bấm "Lưu đơn nháp" — KHÔNG tự lưu ngay,
   * đúng khuôn "Đơn thuốc mẫu". Không tính `warnings` (chỉ đọc để chèn, `computeWarnings()` sẽ tự
   * chạy lại đúng lúc `savePrescriptionItems()` lưu thật).
   */
  async getPreviousPrescription(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<PreviousPrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const previous = await this.prescriptionRepository.findMostRecentSignedForPatient(tx, tenantId, existing.patientId, id);
      if (!previous) return null;
      return { items: previous.items.map((item) => this.toPrescriptionItem(item)) };
    });
  }

  /** `quantity` LUÔN do backend tính (docs/DECISIONS.md #196) — không nhận trực tiếp từ client nữa,
   * đúng khuôn Sáng/Trưa/Chiều/Tối × Số ngày, theo đơn vị nhỏ nhất của thuốc. */
  private toCreateItemData(item: SavePrescriptionItemsRequest['items'][number]) {
    return {
      drugId: item.drugId ?? null,
      freeTextDrugName: item.freeTextDrugName ?? null,
      doseMorning: item.doseMorning,
      doseNoon: item.doseNoon,
      doseAfternoon: item.doseAfternoon,
      doseEvening: item.doseEvening,
      durationDays: item.durationDays,
      quantity: computePrescriptionQuantity(item, item.durationDays),
      instruction: item.instruction ?? null,
    };
  }

  /**
   * "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5) — chặn bypass qua gọi API thẳng
   * khi tenant CHƯA bật `allowFreeTextPrescriptionEnabled` (`DrugPicker.tsx` đã tự ẩn nút, đây là
   * lớp phòng thủ thật ở server, cùng nguyên tắc mọi gate khác trong dự án không tin tưởng riêng
   * frontend).
   */
  private assertFreeTextAllowed(items: SavePrescriptionItemsRequest['items'], allowed: boolean): void {
    if (!allowed && items.some((i) => i.freeTextDrugName !== undefined)) {
      throw new PrescriptionFreeTextDisabledError();
    }
  }

  /**
   * PRE-02 (trùng hoạt chất) + PRE-03 (đối chiếu dị nguyên đã biết) — CẢNH BÁO MỀM, không chặn ký
   * (xem docstring `signPrescription`). Kho Thuốc GĐ5: thêm `stock_insufficient` (kê vượt TỔNG tồn
   * kho toàn phòng khám) — CŨNG chỉ cảnh báo mềm ở đây; `signPrescription()` mới là nơi chặn CỨNG
   * khi tenant bật `prescriptionStockBlockEnabled` (xem `PrescriptionStockInsufficientError`).
   * `onHandByDrugId=null` (mặc định) — caller ở path KHÔNG cần cảnh báo tồn kho (in đơn, xem lịch
   * sử) cứ để mặc định, BỎ QUA hoàn toàn việc tính `stock_insufficient` — KHÁC hẳn truyền `{}` (nghĩa
   * là "đã tra tồn kho thật, xác nhận = 0" cho MỌI thuốc, sẽ báo vượt tồn SAI cho mọi dòng).
   */
  private computeWarnings(items: PrescriptionWithItems['items'], allergenNames: string[], onHandByDrugId: Record<string, number> | null = null): PrescriptionWarning[] {
    const lines: PrescriptionDrugLine[] = items.map((i) => ({ drugId: i.drugId, drugName: i.drugName, activeIngredient: i.activeIngredient }));
    const duplicates = findDuplicateActiveIngredients(lines).map(
      (d): PrescriptionWarning => ({ kind: 'duplicate_active_ingredient', label: d.activeIngredient, drugNames: d.drugNames }),
    );
    const allergies = findAllergyMatches(lines, allergenNames).map((a): PrescriptionWarning => ({ kind: 'allergy', label: a.allergenName, drugNames: a.drugNames }));
    // Dòng "kê thuốc tự do" không có khái niệm tồn kho — loại khỏi tính `stock_insufficient`.
    const stockLines = items
      .filter((i): i is PrescriptionWithItems['items'][number] & { drugId: string } => i.drugId !== null)
      .map((i) => ({ drugId: i.drugId, drugName: i.drugName, quantity: i.quantity }));
    const shortages = onHandByDrugId === null
      ? []
      : findInsufficientStock(stockLines, onHandByDrugId).map(
          (s): PrescriptionWarning => ({ kind: 'stock_insufficient', label: s.drugName, drugNames: [`cần ${s.required}, còn ${s.onHand}`] }),
        );
    return [...duplicates, ...allergies, ...shortages];
  }

  private toPrescriptionResponse(row: PrescriptionWithItems, allergenNames: string[], onHandByDrugId: Record<string, number> | null = null): PrescriptionDto {
    return {
      id: row.id,
      encounterId: row.encounterId,
      items: row.items.map((item) => this.toPrescriptionItem(item)),
      warnings: this.computeWarnings(row.items, allergenNames, onHandByDrugId),
      prescriptionNo: row.prescriptionNo,
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
      freeTextDrugName: item.freeTextDrugName,
      activeIngredient: item.activeIngredient,
      doseMorning: item.doseMorning,
      doseNoon: item.doseNoon,
      doseAfternoon: item.doseAfternoon,
      doseEvening: item.doseEvening,
      durationDays: item.durationDays,
      quantity: item.quantity,
      unitCode: item.unitCode,
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

  private toPatientVitalSignHistoryItem(vitalSign: VitalSign): PatientVitalSignHistoryItem {
    return {
      id: vitalSign.id,
      encounterId: vitalSign.encounterId,
      measuredAt: vitalSign.measuredAt.toISOString(),
      weightGram: vitalSign.weightGram,
      heightMm: vitalSign.heightMm,
      bpSystolic: vitalSign.bpSystolic,
      bpDiastolic: vitalSign.bpDiastolic,
      temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : null,
      pulse: vitalSign.pulse,
      spo2: vitalSign.spo2,
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

  /**
   * Hẹn tái khám (#222) — ngày hẹn phải SAU ngày khám (ngày lịch giờ Việt Nam của `checkedInAt`) và không quá 365 ngày; có hướng "Hẹn tái khám" ⇔ có ngày (Zod đã kiểm, kiểm lại ở đây
   * vì cần ngày khám). Ném `FollowUpDateInvalidError` (422).
   */
  private assertFollowUpValid(checkedInAt: Date, plan: TreatmentPlanInput): void {
    if (plan.followUpDate === null) return;
    const resolved = resolveFollowUpFromDate(getVietnamDateString(checkedInAt), plan.followUpDate);
    if (!resolved.ok) {
      throw new FollowUpDateInvalidError(resolved.message);
    }
  }

  /** Mục "Điều trị" của bệnh án PDF (#222): hướng điều trị + nội dung điều trị + lời dặn + hẹn tái khám. */
  private toMedicalRecordTreatment(note: ClinicalNoteResponse): NonNullable<MedicalRecordEncounterEntry['treatment']> {
    const followUp = note.treatmentPlan?.followUpDate ?? null;
    return {
      directionLabels: (note.treatmentPlan?.directions ?? []).map((d) => TREATMENT_DIRECTION_LABELS[d]),
      content: note.plan?.content ?? '',
      advice: note.doctorAdvice?.content ?? '',
      followUpDateLabel: followUp ? `${vietnameseWeekdayLabel(followUp)}, ${formatDateStringVi(followUp)}` : null,
    };
  }

  private toClinicalNoteResponse(rows: ClinicalNote[], plan: EncounterTreatmentPlan | null = null): ClinicalNoteResponse {
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
      conclusion: bySection.get('CONCLUSION') ?? null,
      doctorAdvice: bySection.get('DOCTOR_ADVICE') ?? null,
      treatmentPlan: plan
        ? {
            directions: plan.directions,
            followUpDate: dbDateToDateString(plan.followUpDate),
            version: plan.version,
            signedAt: plan.signedAt ? plan.signedAt.toISOString() : null,
            signedBy: plan.signedBy,
            supersedesId: plan.supersedesId,
            amendmentReason: plan.amendmentReason,
          }
        : null,
    };
  }
}
