import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  CLINIC_CONFIG_READER_PORT,
  DOCTOR_SHIFT_CLOSURE_PORT,
  DoctorShiftNotClosedError,
  formatVietnamDateDisplay,
  type DoctorShiftClosurePort,
  ClinicalRecordAlreadySignedError,
  DEFAULT_PRESCRIPTION_KIND_MAPPING,
  groupByPrescriptionKind,
  resolvePrescriptionKind,
  type PrescriptionKindMapping,
  type PatientReaderPort,
  ConcurrentModificationError,
  DiagnosisPrimaryRequiredError,
  DOCTOR_DIRECTORY_PORT,
  PATIENT_READER_PORT,
  DoctorNoShiftOnDateError,
  WORK_SHIFT_ASSIGNMENT_READER_PORT,
  type WorkShiftAssignmentReaderPort,
  EncounterAlreadyClaimedError,
  EncounterNotCompletedError,
  EncounterNotInConsultationError,
  EncounterNotReassignableError,
  EncounterPaymentRequiredError,
  FollowUpDateInvalidError,
  CLINICAL_ORDER_CANCELLATION_PORT,
  ENCOUNTER_BILLING_READER_PORT,
  PARACLINICAL_PROGRESS_READER_PORT,
  PARACLINICAL_RESULTS_READER_PORT,
  PDF_RENDERER_PORT,
  PrescriptionAlreadySignedError,
  PrescriptionEmptyError,
  PrescriptionFreeTextDisabledError,
  PrescriptionItemMissingDoseError,
  PrescriptionNonSplittableDoseError,
  PrescriptionRequiresDiagnosisError,
  PrescriptionStockInsufficientError,
  PrescriptionWarningNotAcknowledgeableError,
  renderPatientMedicalRecordHtml,
  renderEncounterMedicalRecordHtml,
  REFERENCE_CATALOG_READER_PORT,
  type ReferenceCatalogReaderPort,
  type EncounterMedicalRecordDocument,
  type MedicalRecordPrintOptions,
  SIGNATURE_PORT,
  STOCK_AVAILABILITY_PORT,
  assertEncounterTransition,
  evaluateVitalSignWarnings,
  findAllergyMatches,
  findDuplicateActiveIngredients,
  findInsufficientStock,
  findNonSplittableFractionalDoses,
  formatDateStringVi,
  getVietnamDateString,
  resolveFollowUpFromDate,
  vietnameseWeekdayLabel,
  resolveDoctorDepartmentRouting,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type MedicalRecordEncounterEntry,
  type MedicalRecordInsurance,
  type PatientMedicalRecordDocument,
  type ClinicalOrderCancellationPort,
  type EncounterBillingReaderPort,
  type ParaclinicalProgressReaderPort,
  type ParaclinicalResultsReaderPort,
  type PdfRendererPort,
  type PrescriptionDrugLine,
  type SignaturePort,
  type StockAvailabilityPort,
  BRANCH_DIRECTORY_PORT,
  type BranchDirectoryPort,
  maxDataScope,
} from '@nexamed/core';
import { FAMILY_RELATION_LABELS, TREATMENT_DIRECTION_LABELS, type PrescriptionKind, calculateAgeMonths, calculateAgeYears, formatPrescriptionDose, hasFractionalPrescriptionDose, isPrescriptionDoseComplete, resolvePrescriptionItemDose } from '@nexamed/shared';
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
  PrescriptionDocument as PrescriptionDocumentDto,
  PrescriptionItem as PrescriptionItemDto,
  PatientClinicalSummaryResponse,
  ListPatientEncounterHistoryQuery,
  MedicalRecordParaclinicalResponse,
  PatientEncounterHistoryResponse,
  PatientVitalSignHistoryItem,
  PreviousPrescriptionResponse,
  PrescriptionPrintInfo,
  PrescriptionResponse,
  PrescriptionWarning,
  ReassignEncounterRequest,
  ReleaseEncounterRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  SavePrescriptionItemsRequest,
  AcknowledgePrescriptionWarningRequest,
  SignPrescriptionRequest,
  StartConsultationRequest,
  TreatmentPlanInput,
  VitalSignResponse,
} from '@nexamed/shared';
import type { ClinicalNote, EncounterTreatmentPlan, Prisma, VitalSign } from '@prisma/client';
import { PrintTemplateService } from '../print-template/print-template.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { findAllPermissionsForUser, findScopesForUserPermission } from '../../infrastructure/persistence/permission-lookup.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DiagnosisSuggestionService } from './diagnosis-suggestion.service';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository, type DiagnosisWithIcd10Name } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { TreatmentPlanRepository, dbDateToDateString } from './treatment-plan.repository';
import { PrescriptionRepository, type DrugDoseConfig, type PrescriptionWithItems } from './prescription.repository';
import { toEncounterSummary } from './encounter.mapper';
import { PatientAllergenRepository } from '../patient/patient-allergen.repository';
import { PatientConditionRepository } from '../patient/patient-condition.repository';
import { PatientFamilyHistoryRepository } from '../patient/patient-family-history.repository';
import { PatientService } from '../patient/patient.service';
import { PatientInsuranceCardService } from '../patient/patient-insurance-card.service';
import { InvoiceRepository } from '../billing/invoice.repository';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { BusinessCodeService } from '../clinic/business-code.service';
import { GeoRepository } from '../geo/geo.repository';
import { PrescriptionInteropService } from '../prescription-interop/prescription-interop.service';
import { PrescriptionSubmissionRepository } from '../prescription-interop/prescription-submission.repository';

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
/** Một cảnh báo trùng hoạt chất bác sĩ đã bỏ qua trên đơn nháp (#228) — cột JSONB `prescription.acknowledged_warnings`. */
interface AcknowledgedWarning {
  key: string;
  reason: string | null;
  by: string;
  byName: string;
  at: string;
}

const acknowledgedWarningsSchema = z.array(
  z.object({ key: z.string(), reason: z.string().nullable(), by: z.string(), byName: z.string(), at: z.string() }),
);

/** Đọc cột JSONB an toàn — dữ liệu hỏng/không đúng khuôn coi như chưa bỏ qua cảnh báo nào (không bao giờ làm hỏng việc xem đơn). */
function parseAcknowledgedWarnings(value: unknown): AcknowledgedWarning[] {
  const parsed = acknowledgedWarningsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Chế độ mã đơn "Chuẩn Bộ Y tế" + ánh xạ loại thuốc → loại đơn (#242), đọc TRƯỚC transaction chính của mỗi thao tác kê đơn. */
interface PrescriptionKindContext {
  standardMode: boolean;
  mapping: PrescriptionKindMapping;
}

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
    private readonly insuranceCardService: PatientInsuranceCardService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly clinicProfileService: ClinicProfileService,
    private readonly businessCodeService: BusinessCodeService,
    private readonly geoRepository: GeoRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(PATIENT_READER_PORT) private readonly patientReader: PatientReaderPort,
    @Inject(SIGNATURE_PORT) private readonly signaturePort: SignaturePort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
    @Inject(PDF_RENDERER_PORT) private readonly pdfRenderer: PdfRendererPort,
    @Inject(STOCK_AVAILABILITY_PORT) private readonly stockAvailability: StockAvailabilityPort,
    @Inject(PARACLINICAL_RESULTS_READER_PORT) private readonly paraclinicalResultsReader: ParaclinicalResultsReaderPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(PARACLINICAL_PROGRESS_READER_PORT) private readonly paraclinicalProgress: ParaclinicalProgressReaderPort,
    @Inject(WORK_SHIFT_ASSIGNMENT_READER_PORT) private readonly workShiftAssignmentReader: WorkShiftAssignmentReaderPort,
    @Inject(DOCTOR_SHIFT_CLOSURE_PORT) private readonly doctorShiftClosure: DoctorShiftClosurePort,
    @Inject(ENCOUNTER_BILLING_READER_PORT) private readonly encounterBillingReader: EncounterBillingReaderPort,
    @Inject(CLINICAL_ORDER_CANCELLATION_PORT) private readonly clinicalOrderCancellation: ClinicalOrderCancellationPort,
    private readonly diagnosisSuggestionService: DiagnosisSuggestionService,
    private readonly printTemplateService: PrintTemplateService,
    private readonly interopService: PrescriptionInteropService,
    private readonly submissionRepository: PrescriptionSubmissionRepository,
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
    branchId: string,
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
    // Phiên trước chưa đóng thì chưa được nhận bệnh nhân mới (mockup duyệt 28/10/2026). Chỉ bác sĩ (`personal`) bắt đầu
    // khám; cổng tự mở transaction riêng nên hỏi TRƯỚC transaction chính. Lượt đang khám dở vẫn hoàn tất bình thường —
    // cổng chỉ chặn việc BẮT ĐẦU/NHẬN lượt mới.
    if (dataScope === 'personal') {
      const pendingClosures = await this.doctorShiftClosure.listPendingClosures(tenantId, branchId, actorId, actorId);
      if (pendingClosures.length > 0) {
        throw new DoctorShiftNotClosedError(pendingClosures.map((day) => formatVietnamDateDisplay(day.date)));
      }
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findByIdWithInvoiceStatus(tx, tenantId, branchId, id);
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
          const recheck = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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

      const updated = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: CancelEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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

      const updated = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: ReleaseEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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

      const updated = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: ReassignEncounterRequest,
    meta: RequestMeta,
  ): Promise<EncounterSummary> {
    // `DoctorDirectoryPort` tự mở transaction RIÊNG — resolve TRƯỚC transaction chính, cùng lý do
    // đã áp dụng ở `ReceptionService.checkIn()`/`registerDirect()`.
    const routing = await resolveDoctorDepartmentRouting(this.doctorDirectory, tenantId, dto);
    // Công tắc con "Chặn cả khi bác sĩ không có ca nào trong ngày" (09/10/2026, #226): đổi sang bác sĩ không có ca hôm
    // nay cũng bị chặn cứng, nếu không lễ tân tiếp nhận bác sĩ có ca rồi đổi sang bác sĩ không ca là lách được quy tắc.
    if (routing.doctorId && (await this.workShiftAssignmentReader.isDoctorBookingBlockedForNoShift(tenantId, branchId, routing.doctorId, getVietnamDateString()))) {
      throw new DoctorNoShiftOnDateError();
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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

      const updated = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
  /**
   * Tồn kho cho cảnh báo `stock_insufficient` của đơn NHÁP hiện tại (`null` = không tính: tenant tắt theo dõi tồn, chưa có đơn,
   * đơn đã ký hoặc chưa có dòng nào). Đọc TRƯỚC transaction chính vì các port tự mở transaction riêng.
   */
  private async loadDraftOnHand(tenantId: string, branchId: string, encounterId: string): Promise<Record<string, number> | null> {
    const pharmacyStockTrackingEnabled = await this.clinicConfigReader.getPharmacyStockTrackingEnabled(tenantId);
    if (!pharmacyStockTrackingEnabled) return null;
    const draftPreview = await this.unitOfWork.runInTenantScope(tenantId, (previewTx) =>
      this.prescriptionRepository.findActiveForEncounter(previewTx, tenantId, encounterId),
    );
    if (!draftPreview || draftPreview.signedAt !== null || draftPreview.items.length === 0) return null;
    // Dòng "kê thuốc tự do" (`drugId=null`) không có khái niệm tồn kho — lọc bỏ trước khi tra.
    const realDrugIds = draftPreview.items.map((i) => i.drugId).filter((v): v is string => v !== null);
    return this.stockAvailability.getOnHandQuantities(tenantId, branchId, [...new Set(realDrugIds)]);
  }

  /**
   * Thông tin bệnh nhân IN THÊM trên đơn thuốc (#242, mockup 20/10/2026): mã BN, CCCD đã giải mã, địa chỉ, SĐT, cân nặng, người giám hộ. Gọi khi bấm In (không nằm trong `getConsultationDetail` để
   * không giải mã CCCD mỗi lần mở màn khám). Chỉ lượt khám của CHI NHÁNH đang làm việc; CCCD chỉ trả cho người có quyền `patient.read` (không có thì `null` — bản in tự ẩn/để chấm). Ghi nhật ký xem ở controller.
   */
  async getPrescriptionPrintInfo(
    tenantId: string,
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    meta: RequestMeta,
  ): Promise<PrescriptionPrintInfo> {
    // "Áp dụng BHYT" (#243) — đọc TRƯỚC transaction (port tự mở transaction riêng).
    const insuranceEnabled = await this.clinicConfigReader.getInsuranceEnabled(tenantId);
    const context = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findForPrescriptionPrint(tx, tenantId, id);
      if (!encounter || encounter.branchId !== branchId || (dataScope === 'personal' && encounter.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const patientScope = maxDataScope(await findScopesForUserPermission(tx, tenantId, actorId, 'patient', 'read'));
      return { patientId: encounter.patientId, weightGram: encounter.vitalSigns[0]?.weightGram ?? null, canReadPatient: patientScope !== 'none', insuranceSnapshot: encounter.insuranceSnapshot };
    });
    // `PatientService` tự mở transaction riêng — gọi NGOÀI transaction trên (cùng nguyên tắc `exportMedicalRecordPdf()`).
    const patient = await this.patientService.getPatient(tenantId, context.patientId);
    const nationalId = context.canReadPatient ? patient.nationalId : null;
    if (nationalId) {
      // Số CCCD đã giải mã đang rời máy chủ để in ra giấy — dòng nhật ký RIÊNG (ngoài `encounter.viewed` chung của `@AuditView`) để truy được "ai đã in CCCD của bệnh nhân này". KHÔNG ghi giá trị CCCD.
      await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
        writeAuditLog(tx, tenantId, {
          actorId,
          action: 'encounter.prescription_printed_with_national_id',
          entityType: 'encounter',
          entityId: id,
          afterJson: { patientId: context.patientId, branchId },
          ip: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
    }
    return {
      patientCode: patient.patientCode,
      nationalId,
      address: patient.address,
      phone: patient.phone,
      weightGram: context.weightGram,
      ageMonths: calculateAgeMonths(patient.dob),
      guardian: patient.relativeFullName ? { fullName: patient.relativeFullName, relationship: patient.relativeRelationship } : null,
      // Số thẻ BHYT hiện rõ cho người có quyền xem hồ sơ bệnh nhân (chủ dự án chốt, #243) — không có quyền thì không trả.
      insurance: context.canReadPatient ? this.insuranceCardService.toEncounterInsurance(context.insuranceSnapshot, insuranceEnabled) : null,
    };
  }

  /**
   * Kết quả cận lâm sàng ĐÃ DUYỆT của một lượt khám cho tab "Hồ sơ bệnh án" (#269). Quy tắc nhìn thấy lượt khám GIỐNG HỆT `getConsultationDetail()`: ngoài scope `personal` hoặc lượt chưa hoàn tất ở chi nhánh khác → 404.
   * Port đọc kết quả tự mở transaction riêng nên gọi NGOÀI transaction kiểm tra quyền xem (nguyên tắc một request = một transaction).
   */
  async getMedicalRecordParaclinical(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<MedicalRecordParaclinicalResponse> {
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findByIdWithConsultationContext(tx, tenantId, id);
      if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) throw new NotFoundException();
      if (encounter.branchId !== branchId && encounter.status !== 'COMPLETED') throw new NotFoundException();
    });
    const byEncounter = await this.paraclinicalResultsReader.listSignedForEncounters(tenantId, [id]);
    const results = (byEncounter[id] ?? []).flatMap((r) => (r.itemId ? [{ ...r, itemId: r.itemId }] : []));
    return { results };
  }

  async getConsultationDetail(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<ConsultationDetailResponse> {
    // Kho Thuốc GĐ5 — đọc cấu hình + tồn kho TRƯỚC transaction chính, cùng nguyên tắc `signPrescription()`
    // (`ClinicConfigReaderPort`/`StockAvailabilityPort` tự mở transaction riêng, không lồng được).
    // Bug thật phát hiện lúc verify Playwright: thiếu đúng đoạn này khiến cảnh báo `stock_insufficient`
    // trả về ĐÚNG ở response `PUT .../prescription-items` nhưng biến mất ngay sau khi trang tự
    // `invalidateQueries` refetch lại `GET .../consultation` (route NÀY, trước đó gọi
    // `toPrescriptionResponse()` không truyền `onHandByDrugId` nên luôn mặc định `null` = không tính
    // cảnh báo tồn kho) — cảnh báo chỉ kịp hiện trong khoảnh khắc trước khi bị ghi đè bởi dữ liệu vừa
    // refetch, coi như KHÔNG BAO GIỜ hiển thị được cho bác sĩ trong thực tế. Chỉ tính cho đơn CHƯA KÝ
    // (đơn đã ký xem như "đã xong", giữ nguyên `null` — đúng khuôn PrescriptionPrintView/lịch sử).
    const onHandByDrugId = await this.loadDraftOnHand(tenantId, branchId, id);
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);
    // "Áp dụng BHYT" (#243) — đọc TRƯỚC transaction chính (port tự mở transaction riêng); tắt thì `insurance = null`.
    const insuranceEnabled = await this.clinicConfigReader.getInsuranceEnabled(tenantId);

    const { history: historyWithDoctorId, ...rest } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findByIdWithConsultationContext(tx, tenantId, id);
      if (!encounter || (dataScope === 'personal' && encounter.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      // Lượt khám ở chi nhánh KHÁC (docs/DECISIONS.md #231): chỉ XEM được khi đã hoàn tất (xem lịch sử khám của bệnh nhân) — lượt đang diễn ra ở nơi khác coi như không tồn tại.
      if (encounter.branchId !== branchId && encounter.status !== 'COMPLETED') {
        throw new NotFoundException();
      }
      if (encounter.branchId !== branchId) {
        // Dữ liệu lâm sàng của chi nhánh khác — ghi dấu vết riêng ngoài nhật ký xem thông thường.
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'encounter.history_viewed_cross_branch',
          entityType: 'encounter',
          entityId: id,
          afterJson: { viewerBranchId: branchId, encounterBranchId: encounter.branchId },
        });
      }

      const latestVitalSign = encounter.vitalSigns[0] ?? null;
      const vitalSigns = latestVitalSign ? this.toVitalSignResponse(latestVitalSign, encounter.patient.dob) : null;

      const historyRows = await this.encounterRepository.listHistoryForPatient(tx, tenantId, encounter.patientId, id, CONSULTATION_HISTORY_LIMIT);
      const history = historyRows.map((row) => ({
        encounterId: row.id,
        branchId: row.branchId,
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
        insurance: this.insuranceCardService.toEncounterInsurance(encounter.insuranceSnapshot, insuranceEnabled),
        history,
        diagnoses,
        clinicalNote: this.toClinicalNoteResponse(noteRows, treatmentPlanRow),
        prescription: prescriptionRow ? this.toPrescriptionResponse(prescriptionRow, allergenRows.map((a) => a.allergenName), onHandByDrugId, kindCtx) : null,
      };
    });

    // Tên bác sĩ từng lượt khám cũ (panel tiền sử, yêu cầu chủ dự án) — `DoctorDirectoryPort` tự mở
    // transaction RIÊNG (cùng nguyên tắc `startConsultation()`), nên phải gọi NGOÀI transaction
    // chính ở trên để tránh `$transaction` lồng nhau.
    const doctorIds = [...new Set(historyWithDoctorId.map((h) => h.doctorId).filter((v): v is string => v !== null))];
    const doctorNames = doctorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, doctorIds) : new Map<string, string>();
    // Tên chi nhánh chỉ ghi khi lượt khám cũ ở chi nhánh KHÁC chi nhánh đang làm (cùng chi nhánh → không ghi gì; phòng khám 1 chi nhánh không thấy khác biệt).
    const branchNames = historyWithDoctorId.some((h) => h.branchId !== branchId) ? await this.branchDirectory.getBranchNames(tenantId) : new Map<string, string>();
    const history = historyWithDoctorId.map(({ doctorId, branchId: rowBranchId, ...h }) => ({
      ...h,
      doctorName: doctorId ? (doctorNames.get(doctorId) ?? null) : null,
      branchName: rowBranchId !== branchId ? (branchNames.get(rowBranchId) ?? null) : null,
    }));

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
   * Tab "Lịch sử khám chữa bệnh" ở hồ sơ bệnh nhân (docs/DECISIONS.md #223, mockup đã duyệt) — gate `patient.read` ở controller, CỐ Ý không giới hạn `data_scope=personal` (xem đủ mọi
   * bác sĩ, #130). Nội dung lâm sàng (chẩn đoán, kết luận, hẹn tái khám, đơn thuốc, cận lâm sàng) CHỈ được đọc/gửi khi actor có `encounter.read_clinical`; chi phí chỉ khi có
   * `invoice.read` — máy chủ không gửi trường nào actor không được xem (không chỉ ẩn ở giao diện). Chỉ lấy bản ĐÃ KÝ của chẩn đoán/ghi chú/kế hoạch điều trị/đơn thuốc: lượt khám
   * đang dở không lộ bản nháp.
   */
  async listPatientEncounterHistory(tenantId: string, branchId: string, actorId: string, patientId: string, query: ListPatientEncounterHistoryQuery): Promise<PatientEncounterHistoryResponse> {
    // Mã bệnh nhân không thuộc công ty này → 404 như MỌI endpoint theo bệnh nhân khác (`/patients/:id`, thẻ BHYT, ví, kết quả cận lâm sàng). Trước đây trả 200 + danh sách rỗng: không rò rỉ
    // dữ liệu (đã kiểm chứng ở bản SaaS chạy thật, docs/DECISIONS.md #244) nhưng khác biệt với các endpoint còn lại, và để lộ được 'mã này có tồn tại hay không' qua so sánh phản hồi.
    const [patient] = await this.patientReader.findSummariesByIds(tenantId, [patientId]);
    if (!patient) throw new NotFoundException();
    const permissions = await this.unitOfWork.runInTenantScope(tenantId, (tx) => findAllPermissionsForUser(tx, tenantId, actorId));
    const canViewClinical = 'encounter.read_clinical' in permissions;
    const canViewBilling = 'invoice.read' in permissions;
    // "Áp dụng BHYT" (#243) — đọc ngoài transaction; tắt thì mỗi lượt khám trả `insurance = null`.
    const insuranceEnabled = await this.clinicConfigReader.getInsuranceEnabled(tenantId);

    const page = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.encounterRepository.listHistoryPageForPatient(tx, tenantId, patientId, query.status === 'COMPLETED', query.cursor, query.limit);
      const counts = await this.encounterRepository.countHistoryForPatient(tx, tenantId, patientId);
      const hasMore = rows.length > query.limit;
      const encounters = hasMore ? rows.slice(0, query.limit) : rows;
      const ids = encounters.map((e) => e.id);
      const clinicalRows = canViewClinical
        ? await Promise.all([
            this.diagnosisRepository.listForEncounters(tx, tenantId, ids),
            this.clinicalNoteRepository.listForEncounters(tx, tenantId, ids),
            this.treatmentPlanRepository.findActiveForEncounters(tx, tenantId, ids),
            this.prescriptionRepository.findActiveForEncounters(tx, tenantId, ids),
          ]).then(([diagnoses, notes, plans, prescriptions]) => ({ diagnoses, notes, plans, prescriptions }))
        : null;
      return { encounters, counts, nextCursor: hasMore ? (encounters[encounters.length - 1]?.id ?? null) : null, clinicalRows };
    });

    // Các port dưới đây tự mở transaction riêng — gọi NGOÀI transaction trên (cùng nguyên tắc `getConsultationDetail`).
    const ids = page.encounters.map((e) => e.id);
    const doctorIds = [...new Set(page.encounters.map((e) => e.doctorId).filter((v): v is string => v !== null))];
    // Lịch sử khám đi theo NGƯỜI BỆNH nên hiện mọi chi nhánh (docs/DECISIONS.md #231); tiền là của chi nhánh → che nếu actor không được gán chi nhánh đó.
    const [branchNames, assignedBranchIds, multiBranch] = await Promise.all([
      this.branchDirectory.getBranchNames(tenantId),
      this.branchDirectory.listAssignedBranchIds(tenantId, actorId),
      this.branchDirectory.isMultiBranch(tenantId),
    ]);
    const assigned = new Set(assignedBranchIds);
    const [doctorNames, departmentNames, clsCounts, billing] = await Promise.all([
      doctorIds.length > 0 ? this.doctorDirectory.getUserFullNames(tenantId, doctorIds) : Promise.resolve(new Map<string, string>()),
      this.doctorDirectory.getDepartmentNames(tenantId),
      canViewClinical ? this.paraclinicalProgress.getResultCountsByEncounter(tenantId, ids) : Promise.resolve(new Map<string, { total: number; withResult: number }>()),
      canViewBilling ? this.encounterBillingReader.getSummaryByEncounter(tenantId, ids) : Promise.resolve(new Map()),
    ]);

    const items = page.encounters.map((e) => {
      let clinical: PatientEncounterHistoryResponse['items'][number]['clinical'] = null;
      let reason = e.chiefComplaint;
      if (page.clinicalRows) {
        const rows = page.clinicalRows;
        const signedDiagnoses = (rows.diagnoses.get(e.id) ?? []).filter((d) => d.signedAt !== null);
        const primary = signedDiagnoses.find((d) => d.type === 'PRIMARY') ?? null;
        const signedNotes = (rows.notes.get(e.id) ?? []).filter((n) => n.signedAt !== null);
        const noteContent = (section: string) => signedNotes.find((n) => n.section === section)?.content.trim() || null;
        const plan = rows.plans.get(e.id);
        const signedPlan = plan && plan.signedAt !== null ? plan : null;
        const prescription = rows.prescriptions.get(e.id);
        const signedPrescription = prescription && prescription.signedAt !== null ? prescription : null;
        const cls = clsCounts.get(e.id);
        if (!reason) reason = noteContent('REASON_FOR_VISIT');
        clinical = {
          primaryDiagnosisCode: primary?.icd10Code ?? null,
          primaryDiagnosisName: primary?.icd10.nameVi ?? null,
          otherDiagnosisCount: primary ? signedDiagnoses.length - 1 : signedDiagnoses.length,
          conclusion: noteContent('CONCLUSION'),
          followUpDate: signedPlan && signedPlan.directions.includes('FOLLOW_UP') && signedPlan.followUpDate ? signedPlan.followUpDate.toISOString().slice(0, 10) : null,
          prescriptionNo: signedPrescription?.prescriptionNo ?? null,
          prescriptionDocuments: (signedPrescription?.documents ?? []).map((d) => ({ kind: d.kind, nationalCode: d.nationalCode })),
          prescriptionItemCount: signedPrescription ? signedPrescription.items.length : 0,
          paraclinical: cls ? { total: cls.total, withResult: cls.withResult } : null,
        };
      }
      const billingHidden = !assigned.has(e.branchId);
      const summary = billingHidden ? undefined : billing.get(e.id);
      return {
        encounterId: e.id,
        encounterNo: e.encounterNo,
        archiveNo: e.archiveNo,
        status: e.status,
        checkedInAt: e.checkedInAt.toISOString(),
        examTypeName: e.examTypeName,
        receptionTypeCode: e.receptionTypeCode,
        doctorName: e.doctorId ? (doctorNames.get(e.doctorId) ?? null) : null,
        departmentName: departmentNames.get(e.departmentId) ?? null,
        reason: reason?.trim() ? reason : null,
        clinical,
        billing: summary ? { netAmount: summary.netAmount, paymentState: summary.paymentState } : null,
        branchName: branchNames.get(e.branchId) ?? null,
        isOtherBranch: e.branchId !== branchId,
        billingHidden,
        // Thẻ đã chụp lúc khám (#243) — không phải dữ liệu tiền nên không bị che theo chi nhánh.
        insurance: this.insuranceCardService.toEncounterInsurance(e.insuranceSnapshot, insuranceEnabled),
      };
    });

    return {
      items,
      nextCursor: page.nextCursor,
      completedCount: page.counts.completed,
      totalCount: page.counts.total,
      canViewClinical,
      canViewBilling,
      multiBranch,
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
    // Bệnh án PDF gộp lượt khám của MỌI chi nhánh (hồ sơ đi theo người bệnh) → đầu trang của CÔNG TY, không gắn một chi nhánh nào (#233).
    const clinicHeader = await this.clinicProfileService.getPrintHeader(tenantId, null);
    // "Áp dụng BHYT" (#243) — đọc TRƯỚC transaction (port tự mở transaction riêng); tắt thì không in dòng BHYT nào.
    const insuranceEnabled = await this.clinicConfigReader.getInsuranceEnabled(tenantId);
    // Tên đơn vị tính của thuốc ('VIEN' → 'viên') — cũng là port tự mở transaction, nên đọc TRƯỚC transaction.
    const unitNames = await this.listUnitNames(tenantId);

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
        vitalSigns: this.toMedicalRecordVitals(vitalSign),
        diagnoses: (diagnosesByEncounter.get(e.id) ?? []).map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10.nameVi, type: d.type, note: d.note })),
        clinicalNoteSections: CLINICAL_NOTE_SECTION_LABELS.map(([key, label]) => ({ label, content: noteResponse[key]?.content ?? '' })),
        treatment: this.toMedicalRecordTreatment(noteResponse),
        paraclinicalResults: paraclinicalByEncounter[e.id] ?? [],
        prescriptionItems: this.toMedicalRecordRxItems(prescriptionRow, unitNames),
        prescriptionDocuments: (prescriptionRow?.documents ?? []).map((d) => ({ kind: d.kind, nationalCode: d.nationalCode })),
        insurance: this.toMedicalRecordInsurance(e.insuranceSnapshot, insuranceEnabled),
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
    const { printOptions, margins } = this.toMedicalRecordPrintOptions(template, insuranceEnabled);
    const html = renderPatientMedicalRecordHtml(document, printOptions);
    const pdf = await this.pdfRenderer.renderHtmlToPdf(html, { marginsMm: { top: margins.topMm, right: margins.rightMm, bottom: margins.bottomMm, left: margins.leftMm } });
    return { pdf, patientCode: patient.patientCode, encounterCount: encounters.length };
  }

  /** Thẻ BHYT đã chụp của một lượt khám → dạng in trong bệnh án PDF (số thẻ đã giải mã); công tắc tắt → `null`. */
  private toMedicalRecordInsurance(snapshotJson: unknown, enabled: boolean): MedicalRecordInsurance | null {
    const insurance = this.insuranceCardService.toEncounterInsurance(snapshotJson, enabled);
    if (!insurance) return null;
    return {
      selfPay: insurance.selfPay,
      cardNo: insurance.cardNo,
      cardNoUnreadable: insurance.cardNoUnreadable,
      kind: insurance.kind,
      validFrom: insurance.validFrom,
      validTo: insurance.validTo,
      benefitRate: insurance.benefitRate,
      facilityName: insurance.facilityName,
    };
  }

  /** Tuỳ chọn trình bày + lề của bản mẫu in `MEDICAL_RECORD` — dùng chung cho "Xuất toàn bộ bệnh án" và "In bộ hồ sơ" một lượt khám (#269). */
  private toMedicalRecordPrintOptions(
    template: Awaited<ReturnType<PrintTemplateService['resolveOne']>>,
    insuranceEnabled: boolean,
  ): { printOptions: MedicalRecordPrintOptions; margins: { topMm: number; rightMm: number; bottomMm: number; leftMm: number } } {
    const { header, margins } = template.config;
    const printOptions: MedicalRecordPrintOptions = {
      header: { showClinicName: header.showClinicName, showAddress: header.showAddress, showPhone: header.showPhone, showTaxCode: header.showTaxCode, showDivider: header.showDivider },
      title: template.config.title.text.trim() || null,
      footerNote: template.config.footer.note.trim() || null,
      // Ô tích "Số thẻ BHYT" của bản mẫu in Bệnh án (S2-04, #243) — công tắc tổng tắt thì không in.
      ...(insuranceEnabled && template.config.insurance ? { insurance: template.config.insurance } : {}),
    };
    return { printOptions, margins };
  }

  private toMedicalRecordVitals(vitalSign: VitalSign | undefined): MedicalRecordEncounterEntry['vitalSigns'] {
    if (!vitalSign) return null;
    return {
      measuredAt: vitalSign.measuredAt.toISOString(),
      pulse: vitalSign.pulse,
      temperatureC: vitalSign.temperatureDeciC !== null ? vitalSign.temperatureDeciC / TEMPERATURE_DECI_PER_CELSIUS : null,
      bpSystolic: vitalSign.bpSystolic,
      bpDiastolic: vitalSign.bpDiastolic,
      respiratoryRate: vitalSign.respiratoryRate,
      spo2: vitalSign.spo2,
      weightGram: vitalSign.weightGram,
      heightMm: vitalSign.heightMm,
    };
  }

  /** Mã → tên đơn vị tính (`reference_catalog` UNIT) để bản in hiện "14 viên" thay vì mã thô "14 VIEN". Gọi NGOÀI transaction. */
  private async listUnitNames(tenantId: string): Promise<Map<string, string>> {
    const units = await this.referenceCatalogReader.listByCategory(tenantId, 'UNIT');
    return new Map(units.map((u) => [u.code, u.name]));
  }

  private toMedicalRecordRxItems(
    row: { items: Array<Parameters<typeof formatPrescriptionDose>[0] & { drugName: string; durationDays: number | null; quantity: number; unitCode: string | null; instruction: string | null }> } | undefined,
    unitNames: Map<string, string>,
  ): MedicalRecordEncounterEntry['prescriptionItems'] {
    return (row?.items ?? []).map((i) => ({
      drugName: i.drugName,
      doseSummary: formatPrescriptionDose(i),
      durationDays: i.durationDays,
      quantity: i.quantity,
      unitCode: i.unitCode ? (unitNames.get(i.unitCode) ?? i.unitCode) : null,
      instruction: i.instruction,
    }));
  }

  /**
   * "In bộ hồ sơ" của MỘT lượt khám đã hoàn tất (docs/DECISIONS.md #269): một tệp PDF gồm tờ khám theo mẫu bệnh án ngoại trú, từng phiếu kết quả cận lâm sàng ĐÃ DUYỆT và đơn thuốc ĐÃ KÝ.
   * Quy tắc nhìn thấy lượt khám giống `getConsultationDetail()` (ngoài scope `personal`, hoặc lượt chưa hoàn tất ở chi nhánh khác → 404); lượt chưa hoàn tất của chính chi nhánh → 409.
   * Đầu phiếu theo CHI NHÁNH của lượt khám (#233). Mọi cổng (`*Port`/`*Service` tự mở transaction riêng) gọi NGOÀI transaction đọc dữ liệu — một request chỉ có MỘT transaction đang giữ kết nối.
   */
  async exportEncounterMedicalRecordPdf(
    tenantId: string,
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    encounterId: string,
    reason: string,
  ): Promise<{ pdf: Buffer; patientId: string; fileLabel: string }> {
    const head = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const e = await this.encounterRepository.findByIdWithConsultationContext(tx, tenantId, encounterId);
      if (!e || (dataScope === 'personal' && e.doctorId !== actorId)) throw new NotFoundException();
      if (e.branchId !== branchId && e.status !== 'COMPLETED') throw new NotFoundException();
      if (e.status !== 'COMPLETED') throw new EncounterNotCompletedError();
      return e;
    });

    const insuranceEnabled = await this.clinicConfigReader.getInsuranceEnabled(tenantId);
    const [patient, clinicHeader, template, paraclinicalByEncounter] = await Promise.all([
      this.patientService.getPatient(tenantId, head.patientId),
      this.clinicProfileService.getPrintHeader(tenantId, head.branchId),
      this.printTemplateService.resolveOne(tenantId, 'MEDICAL_RECORD'),
      this.paraclinicalResultsReader.listSignedForEncounters(tenantId, [encounterId]),
    ]);
    const [doctorNames, departmentNames, branchNames, multiBranch] = await Promise.all([
      head.doctorId ? this.doctorDirectory.getUserFullNames(tenantId, [head.doctorId]) : Promise.resolve(new Map<string, string>()),
      this.doctorDirectory.getDepartmentNames(tenantId),
      this.branchDirectory.getBranchNames(tenantId),
      this.branchDirectory.isMultiBranch(tenantId),
    ]);
    const [ethnicities, nationalities, occupations, receptionTypes, unitNames] = await Promise.all([
      this.referenceCatalogReader.listByCategory(tenantId, 'ETHNICITY'),
      this.referenceCatalogReader.listByCategory(tenantId, 'NATIONALITY'),
      this.referenceCatalogReader.listByCategory(tenantId, 'OCCUPATION'),
      this.referenceCatalogReader.listByCategory(tenantId, 'RECEPTION_TYPE'),
      this.listUnitNames(tenantId),
    ]);
    const nameOf = (items: { code: string; name: string }[], code: string | null): string | null => (code ? (items.find((i) => i.code === code)?.name ?? code) : null);

    const provinceCode = patient.address?.province;
    const wardCode = patient.address?.ward;
    const data = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [provinces, wards, diagnoses, notes, plans, prescriptions, vitals] = await Promise.all([
        this.geoRepository.findProvincesByCodes(tx, provinceCode ? [provinceCode] : []),
        this.geoRepository.findWardsByCodes(tx, wardCode ? [wardCode] : []),
        this.diagnosisRepository.listForEncounters(tx, tenantId, [encounterId]),
        this.clinicalNoteRepository.listForEncounters(tx, tenantId, [encounterId]),
        this.treatmentPlanRepository.findActiveForEncounters(tx, tenantId, [encounterId]),
        this.prescriptionRepository.findActiveForEncounters(tx, tenantId, [encounterId]),
        this.encounterRepository.listLatestVitalSignsForEncounters(tx, tenantId, [encounterId]),
      ]);
      return { provinces, wards, diagnoses, notes, plans, prescriptions, vitals };
    });

    const addressLine = [patient.address?.street, patient.address?.neighborhood, data.wards[0]?.name ?? wardCode, data.provinces[0]?.name ?? provinceCode].filter(Boolean).join(', ') || null;
    const noteResponse = this.toClinicalNoteResponse(data.notes.get(encounterId) ?? [], data.plans.get(encounterId) ?? null);
    const prescriptionRow = data.prescriptions.get(encounterId);
    const signedPrescription = prescriptionRow && prescriptionRow.signedAt ? prescriptionRow : undefined;
    const relative = [patient.relativeFullName, patient.relativeRelationship ? `(${patient.relativeRelationship})` : '', patient.relativePhone ? `— ${patient.relativePhone}` : ''].filter(Boolean).join(' ') || null;
    const text = (section: { content: string } | null | undefined): string => section?.content.trim() ?? '';

    const document: EncounterMedicalRecordDocument = {
      clinic: { name: clinicHeader.name, address: clinicHeader.address, phone: clinicHeader.phone, taxCode: clinicHeader.taxCode },
      patient: {
        patientCode: patient.patientCode,
        fullName: patient.fullName,
        dob: patient.dob,
        genderLabel: GENDER_LABEL[patient.gender] ?? patient.gender,
        phone: patient.phone,
        address: addressLine,
        nationalId: patient.nationalId,
        occupation: nameOf(occupations, patient.occupation),
        ethnicity: nameOf(ethnicities, patient.ethnicity),
        nationality: nameOf(nationalities, patient.nationality),
        personalHistory: patient.personalHistory,
        allergenNames: patient.allergens.map((a) => a.name),
        conditionNames: patient.conditions.map((c) => c.icd10Name),
        familyHistoryLines: patient.familyHistoryRows.map((f) => `${f.relationLabel}: ${f.icd10Name}${f.ageOfOnsetYears != null ? ` (${f.ageOfOnsetYears} tuổi)` : ''}`),
        relative,
      },
      record: {
        archiveNo: head.archiveNo,
        encounterNo: head.encounterNo,
        // Nhãn "Khám mới"/"Tái khám" = tên Loại tiếp nhận của lượt khám (danh mục phòng khám tự cấu hình), không có thì không in.
        visitTypeLabel: receptionTypes.find((t) => t.code === head.receptionTypeCode)?.name ?? null,
        checkedInAt: head.checkedInAt.toISOString(),
        doctorName: head.doctorId ? (doctorNames.get(head.doctorId) ?? null) : null,
        departmentName: departmentNames.get(head.departmentId) ?? null,
        branchName: multiBranch ? (branchNames.get(head.branchId) ?? null) : null,
        signedAt: head.completedAt ? head.completedAt.toISOString() : null,
      },
      insurance: this.toMedicalRecordInsurance(head.insuranceSnapshot, insuranceEnabled),
      vitalSigns: this.toMedicalRecordVitals(data.vitals.get(encounterId)),
      diagnoses: (data.diagnoses.get(encounterId) ?? []).map((d) => ({ icd10Code: d.icd10Code, icd10Name: d.icd10.nameVi, type: d.type, note: d.note })),
      notes: {
        reason: text(noteResponse.reasonForVisit) || (head.chiefComplaint ?? '').trim(),
        illness: text(noteResponse.illnessProgress),
        preliminaryDiagnosis: text(noteResponse.preliminaryDiagnosis),
        generalExam: text(noteResponse.generalExam),
        regionalExam: text(noteResponse.regionalExam),
        summary: text(noteResponse.summary),
        prognosis: text(noteResponse.prognosis),
        advice: text(noteResponse.doctorAdvice),
      },
      treatment: this.toMedicalRecordTreatment(noteResponse),
      paraclinicalResults: paraclinicalByEncounter[encounterId] ?? [],
      prescriptionItems: this.toMedicalRecordRxItems(signedPrescription, unitNames),
      prescriptionDocuments: (signedPrescription?.documents ?? []).map((d) => ({ kind: d.kind, nationalCode: d.nationalCode })),
      generatedAt: new Date().toISOString(),
      reason,
    };

    const { printOptions, margins } = this.toMedicalRecordPrintOptions(template, insuranceEnabled);
    const html = renderEncounterMedicalRecordHtml(document, printOptions);
    const pdf = await this.pdfRenderer.renderHtmlToPdf(html, { marginsMm: { top: margins.topMm, right: margins.rightMm, bottom: margins.bottomMm, left: margins.leftMm } });
    return { pdf, patientId: head.patientId, fileLabel: head.archiveNo ?? head.encounterNo };
  }

  /** Ghi audit cho "In bộ hồ sơ" một lượt khám — gọi SAU khi render thành công (cùng khuôn `recordMedicalRecordExportAudit`). Ghi lý do + số bệnh án, KHÔNG ghi nội dung lâm sàng. */
  async recordEncounterMedicalRecordExportAudit(tenantId: string, actorId: string, encounterId: string, patientId: string, reason: string, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'encounter.medical_record_exported',
        entityType: 'encounter',
        entityId: encounterId,
        afterJson: { patientId, reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SaveDiagnosesRequest,
    meta: RequestMeta,
  ): Promise<SaveDiagnosesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
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
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: SaveClinicalNoteRequest,
    meta: RequestMeta,
  ): Promise<ClinicalNoteResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
      // #269 — Tóm tắt bệnh án + Tiên lượng (tuỳ chọn, cùng khuôn Kết luận/Lời dặn).
      if (dto.summary) sections.push({ section: 'SUMMARY', input: dto.summary });
      if (dto.prognosis) sections.push({ section: 'PROGNOSIS', input: dto.prognosis });
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
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: AmendClinicalNoteRequest,
    meta: RequestMeta,
  ): Promise<ClinicalNoteResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
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
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      assertEncounterTransition(existing.status, 'COMPLETED');

      const primaryCount = await this.diagnosisRepository.countPrimary(tx, tenantId, id);
      if (primaryCount !== 1) {
        throw new DiagnosisPrimaryRequiredError();
      }

      // Chữ ký logic cấp TRƯỚC khi chuyển trạng thái để lấy `signedAt` làm mốc năm của "Số lưu trữ" (#269). Số được cấp cùng transaction: `complete()` thất bại (khoá lạc quan) thì rollback cả bộ đếm.
      const signature = await this.signaturePort.sign(tenantId, actorId, { entityType: 'clinical_record', entityId: id });
      const archiveNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'ARCHIVE_NO', signature.signedAt);

      const count = await this.encounterRepository.complete(tx, tenantId, id, dto.version, actorId, archiveNo);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }
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

      const updated = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
    branchId: string,
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
      ? await this.stockAvailability.getOnHandQuantities(tenantId, branchId, realDrugIds)
      : null;
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
        active = { ...created, items: [], documents: [] };
      }

      const doseConfigs = await this.prescriptionRepository.findDrugDoseConfigs(tx, tenantId, realDrugIds);
      await this.prescriptionRepository.replaceItems(tx, tenantId, active.id, actorId, dto.items.map((item) => this.toCreateItemData(item, doseConfigs)));
      // "Lời dặn của bác sĩ" riêng của đơn (#241) — không gửi = giữ nguyên, '' = xoá.
      // Chỉ ghi khi nội dung ĐỔI THẬT — lưu nháp lặp lại không làm nhảy `version` của đơn (ký/bỏ qua cảnh báo đang dùng version đã đọc).
      if (dto.doctorAdvice !== undefined) {
        const nextAdvice = dto.doctorAdvice.trim() || null;
        if (nextAdvice !== (active.doctorAdvice ?? null)) {
          await this.prescriptionRepository.setDoctorAdvice(tx, tenantId, active.id, nextAdvice, actorId);
        }
      }

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
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName), onHandByDrugId, kindCtx);
    });
  }

  /**
   * "Bỏ qua cảnh báo này cho đơn hiện tại" (#228, chủ dự án chốt: CHỈ cảnh báo trùng hoạt chất, lưu cùng đơn có dấu vết, lý do không
   * bắt buộc). Chỉ đơn NHÁP; `acknowledged=false` bật lại cảnh báo. Ghi nhật ký hoạt động; trả đơn sau khi cập nhật.
   */
  async acknowledgePrescriptionWarning(
    tenantId: string,
    branchId: string,
    actorId: string,
    dataScope: DataScope,
    id: string,
    dto: AcknowledgePrescriptionWarningRequest,
    meta: RequestMeta,
  ): Promise<PrescriptionResponse> {
    const onHandByDrugId = await this.loadDraftOnHand(tenantId, branchId, id);
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);
    // Chế độ "Chặn" thì cảnh báo thuốc không chia được KHÔNG bỏ qua được (#241).
    const prescriptionSplitBlockEnabled = await this.clinicConfigReader.getPrescriptionSplitBlockEnabled(tenantId);
    // `DoctorDirectoryPort` tự mở transaction riêng — tra tên người bỏ qua TRƯỚC transaction chính (lưu snapshot vào dấu vết).
    const actorName = (await this.doctorDirectory.getUserFullNames(tenantId, [actorId])).get(actorId) ?? '—';

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      if (existing.status !== 'IN_CONSULTATION' && existing.status !== 'COMPLETED') {
        throw new EncounterNotInConsultationError();
      }
      const active = await this.prescriptionRepository.findActiveForEncounter(tx, tenantId, id);
      if (!active) {
        throw new NotFoundException();
      }
      if (active.signedAt !== null) {
        throw new PrescriptionAlreadySignedError();
      }

      const allergenNames = (await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId)).map((a) => a.allergenName);
      if (dto.acknowledged) {
        const target = this.computeWarnings(active.items, allergenNames).find((w) => w.key === dto.key);
        const acknowledgeable = target?.kind === 'duplicate_active_ingredient' || (target?.kind === 'not_splittable' && !prescriptionSplitBlockEnabled);
        if (!target || !acknowledgeable) {
          throw new PrescriptionWarningNotAcknowledgeableError();
        }
      }

      const next = parseAcknowledgedWarnings(active.acknowledgedWarnings).filter((a) => a.key !== dto.key);
      if (dto.acknowledged) {
        next.push({ key: dto.key, reason: dto.reason?.trim() ? dto.reason.trim() : null, by: actorId, byName: actorName, at: new Date().toISOString() });
      }
      const count = await this.prescriptionRepository.setAcknowledgedWarnings(tx, tenantId, active.id, dto.version, next, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: dto.acknowledged ? 'prescription.warning_acknowledged' : 'prescription.warning_restored',
        entityType: 'encounter',
        entityId: id,
        afterJson: { key: dto.key, reason: dto.acknowledged ? (dto.reason?.trim() || null) : null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.prescriptionRepository.findById(tx, tenantId, active.id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toPrescriptionResponse(updated, allergenNames, onHandByDrugId, kindCtx);
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
    branchId: string,
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
        onHandByDrugId = await this.stockAvailability.getOnHandQuantities(tenantId, branchId, [...new Set(realDrugIds)]);
      }
    }
    const prescriptionStockBlockEnabled = pharmacyStockTrackingEnabled && (await this.clinicConfigReader.getPrescriptionStockBlockEnabled(tenantId));
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);
    // Tra mã cơ sở KCB TRƯỚC khi mở transaction ký (tra qua port chi nhánh mở transaction riêng — gọi từ bên trong sẽ cạn bể kết nối khi nhiều người ký cùng lúc).
    const facilityCode = kindCtx.standardMode ? await this.businessCodeService.resolveFacilityCodeForBranch(tenantId, branchId) : null;
    // Khuôn mã TUỲ CHỈNH có token [Mã cơ sở KCB] cũng cần mã cơ sở khi sinh `prescription_no` (#248) — tra TRƯỚC transaction ký, cùng lý do như trên.
    const templateFacilityCode = kindCtx.standardMode ? facilityCode : await this.businessCodeService.resolveFacilityCodeIfPrescriptionTemplateNeedsIt(tenantId, branchId);
    const prescriptionSplitBlockEnabled = await this.clinicConfigReader.getPrescriptionSplitBlockEnabled(tenantId);
    // Liên thông đơn thuốc quốc gia (#242 GĐ3): công tắc tổng đọc TRƯỚC transaction (service tự mở transaction riêng) — bật thì xếp mỗi đơn pháp lý vào hàng chờ gửi ngay trong giao dịch ký.
    const interopEnabled = (await this.interopService.getRawSettings(tenantId)).enabled;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
      // Đơn nháp được lưu ngay khi thêm thuốc (chưa có liều) — ký thì mọi dòng phải có liều (#241).
      const missingDose = active.items.filter((i) => !isPrescriptionDoseComplete(i));
      if (missingDose.length > 0) {
        throw new PrescriptionItemMissingDoseError(missingDose.map((i) => ({ drugId: i.drugId, drugName: i.drugName })));
      }
      this.assertNoNonSplittableFractionalDose(active.items, prescriptionSplitBlockEnabled);

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
      const prescriptionNo = await this.businessCodeService.generate(tx, tenantId, actorId, 'PRESCRIPTION', signature.signedAt, { facilityCode: templateFacilityCode ?? undefined });
      // Chế độ "Chuẩn Bộ Y tế": tách theo loại đơn C/N/H/Y, mỗi loại một đơn pháp lý có mã chuẩn riêng (#242).
      if (kindCtx.standardMode && facilityCode !== null) {
        const documents = await this.issuePrescriptionDocuments(tx, tenantId, actorId, active.id, active.items, kindCtx.mapping, facilityCode, null);
        if (interopEnabled) {
          // Đơn ký lúc công tắc liên thông đang TẮT không tự xếp hàng khi bật lại (đã chốt, #242 bổ sung 5).
          for (const doc of documents) {
            await this.submissionRepository.enqueue(tx, tenantId, actorId, {
              branchId: existing.branchId,
              encounterId: id,
              documentId: doc.id,
              nationalCode: doc.nationalCode,
              kind: doc.kind,
              doctorUserId: actorId,
              signedAt: signature.signedAt,
            });
          }
        }
      }
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
      return this.toPrescriptionResponse(updated, allergenNames, onHandByDrugId, kindCtx);
    });
  }

  /**
   * In đơn (PRE-04) — chỉ đơn ĐÃ KÝ mới in được (bố cục in nằm ở tầng web, đây chỉ ghi nhận
   * `printedAt`). Idempotent — in lại không lỗi, không đổi thời điểm in đầu tiên
   * (`markPrintedIfNotYet`).
   */
  async markPrescriptionPrinted(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string, meta: RequestMeta): Promise<PrescriptionResponse> {
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName), null, kindCtx);
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
    branchId: string,
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
      ? await this.stockAvailability.getOnHandQuantities(tenantId, branchId, realDrugIds)
      : null;
    const prescriptionSplitBlockEnabled = await this.clinicConfigReader.getPrescriptionSplitBlockEnabled(tenantId);
    // Mã đơn thuốc chuẩn Bộ Y tế (#242): chế độ + bảng ánh xạ đọc TRƯỚC transaction chính (port tự mở transaction riêng).
    const kindCtx = await this.loadKindContext(tenantId);
    // Mã cơ sở KCB tra TRƯỚC transaction (chỉ khi chế độ chuẩn đang bật); khi chế độ tắt mà đơn gốc đã có mã chuẩn thì lấy 5 số đầu của mã đã cấp (cùng cơ sở).
    const facilityCode = kindCtx.standardMode ? await this.businessCodeService.resolveFacilityCodeForBranch(tenantId, branchId) : null;
    // Liên thông đơn thuốc quốc gia (#242 GĐ3) — xem `signPrescription`.
    const interopEnabled = (await this.interopService.getRawSettings(tenantId)).enabled;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
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
        // Lời dặn riêng của đơn (#241): không gửi = chép từ bản bị đính chính, '' = xoá.
        doctorAdvice: dto.doctorAdvice === undefined ? active.doctorAdvice : dto.doctorAdvice.trim() || null,
      });
      const amendDoseConfigs = await this.prescriptionRepository.findDrugDoseConfigs(tx, tenantId, [...new Set(dto.items.map((i) => i.drugId).filter((v): v is string => v !== undefined))]);
      await this.prescriptionRepository.createItems(tx, tenantId, created.id, actorId, dto.items.map((item) => this.toCreateItemData(item, amendDoseConfigs)));
      // Đơn gốc đã có mã chuẩn (ký lúc chế độ chuẩn bật): đơn pháp lý cùng loại GIỮ mã cũ, loại mới nhận mã mới, loại bị bỏ hết thì mã đó không dùng lại (#242).
      // Đơn gốc ký TRƯỚC ngày bật chế độ chuẩn (không có mã chuẩn) thì đính chính cũng không cấp mã chuẩn (không hồi tố).
      if (active.documents.length > 0) {
        await this.prescriptionRepository.supersedeDocuments(tx, tenantId, active.id, actorId);
        const fresh = await this.prescriptionRepository.findById(tx, tenantId, created.id);
        if (!fresh) {
          throw new NotFoundException();
        }
        const reuse = new Map<string, string>(active.documents.map((d) => [d.kind, d.nationalCode]));
        const reissued = await this.issuePrescriptionDocuments(tx, tenantId, actorId, created.id, fresh.items, kindCtx.mapping, facilityCode ?? active.documents[0]!.nationalCode.slice(0, 5), reuse);
        // Hàng chờ gửi: đơn pháp lý giữ mã nhưng là dòng mới → trỏ sang đơn mới; đã gửi rồi thì thành "Đính chính, chưa gửi"; loại mới xuất hiện thì xếp hàng (nếu đang bật liên thông).
        await this.submissionRepository.syncAfterAmend(tx, tenantId, actorId, {
          branchId: existing.branchId,
          encounterId: id,
          previousCodes: active.documents.map((d) => d.nationalCode),
          newDocuments: reissued,
          doctorUserId: actorId,
          signedAt: signature.signedAt,
          enqueueNew: interopEnabled,
        });
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription.amended',
        entityType: 'encounter',
        entityId: id,
        beforeJson: active.items.map((i) => ({ drugId: i.drugId, doseSummary: formatPrescriptionDose(i), quantity: i.quantity })) as unknown as Prisma.InputJsonValue,
        afterJson: { amendmentReason: dto.amendmentReason, items: dto.items } as unknown as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const allergenRows = await this.patientAllergenRepository.listForPatient(tx, tenantId, existing.patientId);
      const updated = await this.prescriptionRepository.findById(tx, tenantId, created.id);
      if (!updated) {
        throw new NotFoundException();
      }
      // Chặn sau khi đã dựng bản mới trong transaction: ném lỗi thì cả đính chính bị huỷ (cần `is_splittable` của từng thuốc nên chỉ biết được ở đây).
      this.assertNoNonSplittableFractionalDose(updated.items, prescriptionSplitBlockEnabled);
      return this.toPrescriptionResponse(updated, allergenRows.map((a) => a.allergenName), onHandByDrugId, kindCtx);
    });
  }

  /** "Sao chép đơn thuốc lần khám trước" (docs/DECISIONS.md #196, mockup đã duyệt) — đơn ĐÃ KÝ gần
   * nhất của CÙNG bệnh nhân, ở lượt khám KHÁC lượt khám này. `null` nếu chưa từng có đơn nào trước
   * đó. Web chèn cả cụm vào đơn đang kê rồi bác sĩ tự sửa/bấm "Lưu đơn nháp" — KHÔNG tự lưu ngay,
   * đúng khuôn "Đơn thuốc mẫu". Không tính `warnings` (chỉ đọc để chèn, `computeWarnings()` sẽ tự
   * chạy lại đúng lúc `savePrescriptionItems()` lưu thật).
   */
  async getPreviousPrescription(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, id: string): Promise<PreviousPrescriptionResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.encounterRepository.findById(tx, tenantId, branchId, id);
      if (!existing || (dataScope === 'personal' && existing.doctorId !== actorId)) {
        throw new NotFoundException();
      }
      const previous = await this.prescriptionRepository.findMostRecentSignedForPatient(tx, tenantId, existing.patientId, id);
      if (!previous) return null;
      return { items: previous.items.map((item) => this.toPrescriptionItem(item)) };
    });
  }

  /**
   * `quantity` của kiểu "Theo buổi" LUÔN do backend tính (docs/DECISIONS.md #196) = Sáng/Trưa/Chiều/Tối × Số ngày, theo đơn vị nhỏ nhất của thuốc (thuốc tính liều bằng ml thì chia cho dung tích mỗi Hộp
   * rồi làm tròn lên). Kiểu "Khi cần" lấy số lượng bác sĩ nhập. Kiểu kê + đơn vị liều chốt theo cấu hình thuốc hiện tại và CHỤP vào dòng (#267) — `resolvePrescriptionItemDose`.
   */
  private toCreateItemData(item: SavePrescriptionItemsRequest['items'][number], doseConfigs: Map<string, DrugDoseConfig>) {
    const dose = resolvePrescriptionItemDose(item, item.drugId !== undefined ? (doseConfigs.get(item.drugId) ?? null) : null);
    if (dose.doseMode === 'SCHEDULED' && dose.durationDays === null) {
      // Chỉ xảy ra khi thuốc tính liều bằng ml cấu hình "Theo buổi" mà khách gửi dòng "Khi cần" (bỏ số ngày) — không tự bịa số ngày.
      throw new BadRequestException('Thuốc này kê theo buổi nên cần nhập số ngày dùng.');
    }
    return {
      drugId: item.drugId ?? null,
      freeTextDrugName: item.freeTextDrugName ?? null,
      doseMorning: dose.doseMorning,
      doseNoon: dose.doseNoon,
      doseAfternoon: dose.doseAfternoon,
      doseEvening: dose.doseEvening,
      durationDays: dose.durationDays,
      doseMode: dose.doseMode,
      singleDose: dose.singleDose,
      doseUnitName: dose.doseUnitName,
      dosePerBaseUnit: dose.dosePerBaseUnit,
      quantity: dose.quantity,
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

  /** Thuốc không chia được (`is_splittable=false`) đang kê liều lẻ trên đơn (#241) — dùng cho cảnh báo lẫn chặn. */
  private findNonSplittableDoses(items: PrescriptionWithItems['items']) {
    return findNonSplittableFractionalDoses(
      items.map((i) => ({ drugId: i.drugId, drugName: i.drugName, isSplittable: i.isSplittable, hasFractionalDose: hasFractionalPrescriptionDose(i) })),
    );
  }

  /** Chế độ "Chặn kê liều lẻ" bật thì KHÔNG ký/đính chính được đơn có thuốc không chia được kê liều lẻ (422, kèm danh sách thuốc). */
  private assertNoNonSplittableFractionalDose(items: PrescriptionWithItems['items'], blockEnabled: boolean): void {
    if (!blockEnabled) return;
    const offenders = this.findNonSplittableDoses(items);
    if (offenders.length > 0) {
      throw new PrescriptionNonSplittableDoseError(offenders);
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
  private computeWarnings(
    items: PrescriptionWithItems['items'],
    allergenNames: string[],
    onHandByDrugId: Record<string, number> | null = null,
    acknowledged: AcknowledgedWarning[] = [],
  ): PrescriptionWarning[] {
    const lines: PrescriptionDrugLine[] = items.map((i) => ({ drugId: i.drugId, drugName: i.drugName, activeIngredient: i.activeIngredient, ingredientNames: i.ingredientNames }));
    const duplicates = findDuplicateActiveIngredients(lines).map((d): PrescriptionWarning => {
      const key = `duplicate_active_ingredient:${d.key}`;
      const ack = acknowledged.find((a) => a.key === key);
      return {
        kind: 'duplicate_active_ingredient',
        label: d.activeIngredient,
        drugNames: d.drugNames,
        key,
        acknowledged: ack ? { at: ack.at, byName: ack.byName, reason: ack.reason } : null,
      };
    });
    // "Thuốc không chia được nhưng kê liều lẻ" (#241) — bỏ qua được (trừ khi phòng khám bật chế độ Chặn).
    const notSplittable = this.findNonSplittableDoses(items).map((w): PrescriptionWarning => {
      const key = `not_splittable:${w.drugId}`;
      const ack = acknowledged.find((a) => a.key === key);
      return {
        kind: 'not_splittable',
        label: w.drugName,
        drugNames: [w.drugName],
        key,
        acknowledged: ack ? { at: ack.at, byName: ack.byName, reason: ack.reason } : null,
      };
    });
    const allergies = findAllergyMatches(lines, allergenNames).map(
      (a): PrescriptionWarning => ({ kind: 'allergy', label: a.allergenName, drugNames: a.drugNames, key: `allergy:${a.allergenName}`, acknowledged: null }),
    );
    // Dòng "kê thuốc tự do" không có khái niệm tồn kho — loại khỏi tính `stock_insufficient`.
    const stockLines = items
      .filter((i): i is PrescriptionWithItems['items'][number] & { drugId: string } => i.drugId !== null)
      .map((i) => ({ drugId: i.drugId, drugName: i.drugName, quantity: i.quantity }));
    const shortages = onHandByDrugId === null
      ? []
      : findInsufficientStock(stockLines, onHandByDrugId).map(
          (s): PrescriptionWarning => ({
            kind: 'stock_insufficient',
            label: s.drugName,
            drugNames: [`cần ${s.required}, còn ${s.onHand}`],
            key: `stock_insufficient:${s.drugId}`,
            acknowledged: null,
          }),
        );
    return [...duplicates, ...notSplittable, ...allergies, ...shortages];
  }

  /** Chế độ mã đơn chuẩn + bảng ánh xạ loại thuốc → loại đơn (#242) — đọc TRƯỚC transaction chính. */
  private async loadKindContext(tenantId: string): Promise<PrescriptionKindContext> {
    const [standardMode, mapping] = await Promise.all([
      this.clinicConfigReader.getPrescriptionStandardMode(tenantId),
      this.clinicConfigReader.getPrescriptionKindMapping(tenantId),
    ]);
    return { standardMode, mapping };
  }

  /**
   * Tách đơn theo loại C/N/H/Y và cấp mã chuẩn cho từng đơn pháp lý (#242). Chạy TRONG transaction ký/đính chính. `reuse` (đính chính): loại đã có đơn pháp lý ở bản gốc
   * giữ nguyên mã cũ, loại chưa có mới sinh mã. Thứ tự cấp mã C, N, H, Y.
   */
  private async issuePrescriptionDocuments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    prescriptionId: string,
    items: PrescriptionWithItems['items'],
    mapping: PrescriptionKindMapping,
    facilityCode: string,
    reuse: Map<string, string> | null,
  ): Promise<{ id: string; kind: PrescriptionKind; nationalCode: string }[]> {
    const issued: { id: string; kind: PrescriptionKind; nationalCode: string }[] = [];
    const withKind = items.map((i) => ({
      id: i.id,
      kind: resolvePrescriptionKind({ isFreeText: i.drugId === null, controlType: i.controlType, isTraditional: i.isTraditional }, mapping),
    }));
    for (const group of groupByPrescriptionKind(withKind)) {
      const nationalCode = reuse?.get(group.kind) ?? (await this.businessCodeService.generatePrescriptionNationalCode(tx, tenantId, actorId, facilityCode, group.kind));
      const document = await this.prescriptionRepository.createDocument(tx, tenantId, prescriptionId, actorId, { kind: group.kind, nationalCode });
      await this.prescriptionRepository.assignItemsToDocument(tx, tenantId, group.items.map((i) => i.id), document.id, actorId);
      issued.push({ id: document.id, kind: group.kind, nationalCode });
    }
    return issued;
  }

  private toPrescriptionResponse(
    row: PrescriptionWithItems,
    allergenNames: string[],
    onHandByDrugId: Record<string, number> | null = null,
    kindCtx: PrescriptionKindContext = { standardMode: false, mapping: DEFAULT_PRESCRIPTION_KIND_MAPPING },
  ): PrescriptionDto {
    const documentKindById = new Map(row.documents.map((d) => [d.id, d.kind]));
    const kindOf = (item: PrescriptionWithItems['items'][number]) => {
      // Đã có đơn pháp lý: loại cố định theo đơn đã cấp mã. Còn nháp ở chế độ chuẩn: tính theo ánh xạ HIỆN TẠI. Còn lại (chế độ tắt, đơn cũ): không có loại.
      if (item.documentId !== null) return documentKindById.get(item.documentId) ?? null;
      if (kindCtx.standardMode && row.signedAt === null) {
        return resolvePrescriptionKind({ isFreeText: item.drugId === null, controlType: item.controlType, isTraditional: item.isTraditional }, kindCtx.mapping);
      }
      return null;
    };
    const documents: PrescriptionDocumentDto[] = row.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      nationalCode: d.nationalCode,
      itemIds: row.items.filter((i) => i.documentId === d.id).map((i) => i.id),
    }));
    return {
      id: row.id,
      encounterId: row.encounterId,
      items: row.items.map((item) => this.toPrescriptionItem(item, kindOf(item))),
      standardMode: kindCtx.standardMode,
      documents,
      warnings: this.computeWarnings(row.items, allergenNames, onHandByDrugId, parseAcknowledgedWarnings(row.acknowledgedWarnings)),
      doctorAdvice: row.doctorAdvice,
      prescriptionNo: row.prescriptionNo,
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      signedBy: row.signedBy,
      printedAt: row.printedAt ? row.printedAt.toISOString() : null,
      supersedesId: row.supersedesId,
      amendmentReason: row.amendmentReason,
      version: row.version,
    };
  }

  private toPrescriptionItem(item: PrescriptionWithItems['items'][number], kind: PrescriptionItemDto['kind'] = null): PrescriptionItemDto {
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
      doseMode: item.doseMode,
      singleDose: item.singleDose,
      doseUnitName: item.doseUnitName,
      dosePerBaseUnit: item.dosePerBaseUnit,
      quantity: item.quantity,
      unitCode: item.unitCode,
      instruction: item.instruction,
      isSplittable: item.isSplittable,
      kind,
      documentId: item.documentId,
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
      followUpDate: followUp,
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
      summary: bySection.get('SUMMARY') ?? null,
      prognosis: bySection.get('PROGNOSIS') ?? null,
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
