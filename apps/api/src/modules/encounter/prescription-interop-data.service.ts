import { Inject, Injectable } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  computeFollowUpDays,
  groupByPrescriptionKind,
  resolvePrescriptionKind,
  suggestInteropDosePeriod,
  vietnamDateOf,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type InteropItemInput,
  type InteropSubmissionInput,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import { EMPTY_INTEROP_KIND_INFO, calculateAgeMonths, formatDoseSummary, type InteropKindInfoValue, type PrescriptionKind } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { GeoRepository } from '../geo/geo.repository';
import { PatientService } from '../patient/patient.service';
import { PrescriptionSubmissionRepository, type PrescriptionSubmissionRecord } from '../prescription-interop/prescription-submission.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { DiagnosisRepository } from './diagnosis.repository';
import { EncounterInteropInfoRepository } from './encounter-interop-info.repository';
import { EncounterRepository } from './encounter.repository';
import { PrescriptionRepository, type PrescriptionWithItems } from './prescription.repository';
import { TreatmentPlanRepository, dbDateToDateString } from './treatment-plan.repository';

/** Một loại đơn (C/N/H/Y) của lượt khám kèm đầu vào cho `checkInteropReadiness`/`buildGuiDonThuocPayload`. */
export interface GatheredInteropKind {
  kind: PrescriptionKind;
  /** `null` khi đơn còn nháp (chưa cấp mã chuẩn). */
  nationalCode: string | null;
  documentId: string | null;
  /** Giá trị ĐÃ LƯU của các ô bổ sung (không gồm gợi ý). */
  stored: InteropKindInfoValue;
  /** Gợi ý tự điền cho đợt dùng thuốc (N/H/Y). */
  suggestedDose: { number: number; from: string; to: string } | null;
  input: InteropSubmissionInput;
}

export interface GatheredInteropEncounter {
  encounterId: string;
  branchId: string;
  patientId: string;
  /** Bác sĩ phụ trách lượt khám (để kiểm `data_scope=personal` ở đường người dùng). */
  encounterDoctorId: string | null;
  standardMode: boolean;
  prescription: { id: string; signed: boolean; signedAt: Date | null; signedBy: string | null; version: number } | null;
  doctorName: string | null;
  kinds: GatheredInteropKind[];
  submissions: PrescriptionSubmissionRecord[];
  patient: { version: number; ageMonths: number; relativeFullName: string | null; relativeRelationship: string | null; relativePhone: string | null; relativeAddress: string | null };
}

/**
 * Gom dữ liệu để kiểm/gửi đơn thuốc liên thông (docs/DECISIONS.md #242 GĐ3, mockup 8a/8b): đơn, thuốc (mã quốc gia, hoạt chất, đơn vị), bệnh nhân (CCCD đã giải mã, địa chỉ ghép chữ, cân nặng,
 * người thân), chẩn đoán + kết luận, hẹn tái khám, bác sĩ ký, và các ô bổ sung đã lưu. Dựng lại MỖI LẦN từ trạng thái hiện tại (không lưu bản sao gói). KHÔNG lồng transaction: đọc DB trước, rồi
 * lần lượt gọi các service tự mở transaction riêng (bài học #242).
 *
 * Giá trị tự điền: đợt dùng thuốc chưa nhập thì dùng gợi ý (đợt 1, từ ngày = ngày kê, đến ngày = ngày kê + số ngày thuốc dài nhất − 1) — đúng mockup "Tự điền … Sửa được".
 */
@Injectable()
export class PrescriptionInteropDataService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly encounterRepository: EncounterRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    private readonly diagnosisRepository: DiagnosisRepository,
    private readonly clinicalNoteRepository: ClinicalNoteRepository,
    private readonly treatmentPlanRepository: TreatmentPlanRepository,
    private readonly interopInfoRepository: EncounterInteropInfoRepository,
    private readonly submissionRepository: PrescriptionSubmissionRepository,
    private readonly patientService: PatientService,
    private readonly geoRepository: GeoRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /**
   * `branchId` truyền vào = chỉ lượt khám của chi nhánh đó (đường người dùng); bỏ trống = bộ gửi nền (đã ở đúng công ty). Trả `null` khi không có lượt khám / không có đơn.
   * Lượt khám không có đơn thuốc → `kinds` rỗng chứ không `null` ở đường người dùng; nên `null` chỉ khi lượt khám không tồn tại (hoặc sai chi nhánh).
   */
  async gather(tenantId: string, encounterId: string, opts: { branchId?: string; now?: Date } = {}): Promise<GatheredInteropEncounter | null> {
    const now = opts.now ?? new Date();
    const [standardMode, mapping] = await Promise.all([
      this.clinicConfigReader.getPrescriptionStandardMode(tenantId),
      this.clinicConfigReader.getPrescriptionKindMapping(tenantId),
    ]);

    const rows = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const encounter = await this.encounterRepository.findForPrescriptionPrint(tx, tenantId, encounterId);
      if (!encounter || (opts.branchId !== undefined && encounter.branchId !== opts.branchId)) return null;
      const [prescription, diagnoses, notes, plan, stored, submissions] = await Promise.all([
        this.prescriptionRepository.findActiveForEncounter(tx, tenantId, encounterId),
        this.diagnosisRepository.listForEncounter(tx, tenantId, encounterId),
        this.clinicalNoteRepository.listForEncounter(tx, tenantId, encounterId),
        this.treatmentPlanRepository.findActive(tx, tenantId, encounterId),
        this.interopInfoRepository.listForEncounter(tx, tenantId, encounterId),
        this.submissionRepository.listForEncounter(tx, tenantId, encounterId),
      ]);
      return { encounter, prescription, diagnoses, notes, plan, stored, submissions };
    });
    if (!rows) return null;
    const { encounter, prescription, diagnoses, notes, plan, stored, submissions } = rows;

    // Bên ngoài transaction: mỗi service/port tự mở transaction riêng.
    const patient = await this.patientService.getPatient(tenantId, encounter.patientId);
    const provinceCode = patient.address?.province;
    const wardCode = patient.address?.ward;
    const [provinces, wards] = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      Promise.all([this.geoRepository.findProvincesByCodes(tx, provinceCode ? [provinceCode] : []), this.geoRepository.findWardsByCodes(tx, wardCode ? [wardCode] : [])]),
    );
    const addressLine = [patient.address?.street, patient.address?.neighborhood, wards[0]?.name ?? wardCode, provinces[0]?.name ?? provinceCode].filter(Boolean).join(', ') || null;
    const unitNames = new Map((await this.referenceCatalogReader.listByCategory(tenantId, 'UNIT')).map((u) => [u.code, u.name]));

    const signedBy = prescription?.signedBy ?? null;
    let doctorName: string | null = null;
    let doctorLicenseNo: string | null = null;
    if (signedBy) {
      doctorName = (await this.doctorDirectory.getUserFullNames(tenantId, [signedBy])).get(signedBy) ?? null;
      const doctors = await this.doctorDirectory.listActiveDoctors(tenantId, encounter.branchId);
      doctorLicenseNo = doctors.find((d) => d.id === signedBy)?.licenseNo ?? null;
    }

    const conclusion = notes.find((n) => n.section === 'CONCLUSION')?.content ?? null;
    const ageMonths = calculateAgeMonths(patient.dob);
    const weightGram = encounter.vitalSigns[0]?.weightGram ?? null;
    const followUpDate = plan ? dbDateToDateString(plan.followUpDate) : null;
    const groups = this.buildKindGroups(prescription, standardMode, mapping);

    const kinds: GatheredInteropKind[] = groups.map((group) => {
      const storedInfo = stored.get(group.kind) ?? EMPTY_INTEROP_KIND_INFO;
      const prescribedAt = prescription?.signedAt ?? now;
      const longestDays = Math.max(1, ...group.items.map((i) => i.durationDays));
      const suggestedDose = group.kind === 'C' ? null : suggestInteropDosePeriod(vietnamDateOf(prescribedAt), longestDays);
      const items: InteropItemInput[] = group.items.map((i) => ({
        isFreeText: i.drugId === null,
        drugName: i.drugName,
        drugNationalCode: i.nationalCode,
        activeIngredient: i.activeIngredient,
        unitName: i.unitCode ? (unitNames.get(i.unitCode) ?? i.unitCode) : null,
        quantity: i.quantity,
        doseSummary: formatDoseSummary(i),
        durationDays: i.durationDays,
        instruction: i.instruction,
      }));
      const effectiveDose =
        group.kind === 'C'
          ? null
          : { number: storedInfo.dosePeriodNumber ?? suggestedDose!.number, from: storedInfo.doseFrom ?? suggestedDose!.from, to: storedInfo.doseTo ?? suggestedDose!.to };
      const input: InteropSubmissionInput = {
        kind: group.kind,
        nationalCode: group.nationalCode ?? '',
        prescribedAt,
        patient: {
          fullName: patient.fullName,
          dob: patient.dob,
          gender: patient.gender,
          phone: patient.phone,
          nationalId: patient.nationalId,
          insuranceNumber: patient.insuranceNumber,
          address: addressLine,
          weightGram,
          ageMonths,
          guardian: { fullName: patient.relativeFullName, phone: patient.relativePhone, address: patient.relativeAddress },
        },
        diagnoses: diagnoses.map((d) => ({ code: d.icd10Code, name: d.icd10.nameVi, note: d.note })),
        conclusion,
        doctorLicenseNo,
        doctorAdvice: prescription?.doctorAdvice ?? null,
        followUpDays: computeFollowUpDays(prescribedAt, followUpDate),
        treatmentFormCode: group.kind === 'C' ? storedInfo.treatmentFormCode : null,
        dosePeriod: effectiveDose,
        herbalDoses: group.kind === 'Y' ? storedInfo.herbalDoses : null,
        herbalInstruction: group.kind === 'Y' ? storedInfo.herbalInstruction : null,
        items,
      };
      return { kind: group.kind, nationalCode: group.nationalCode, documentId: group.documentId, stored: storedInfo, suggestedDose, input };
    });

    return {
      encounterId,
      branchId: encounter.branchId,
      patientId: encounter.patientId,
      encounterDoctorId: encounter.doctorId,
      standardMode,
      prescription: prescription ? { id: prescription.id, signed: prescription.signedAt !== null, signedAt: prescription.signedAt, signedBy, version: prescription.version } : null,
      doctorName,
      kinds,
      submissions,
      patient: {
        version: patient.version,
        ageMonths,
        relativeFullName: patient.relativeFullName,
        relativeRelationship: patient.relativeRelationship,
        relativePhone: patient.relativePhone,
        relativeAddress: patient.relativeAddress,
      },
    };
  }

  /**
   * Các loại đơn của lượt khám: đã ký ở chế độ chuẩn → theo đơn pháp lý (có mã); còn nháp ở chế độ chuẩn → theo ánh xạ loại thuốc HIỆN TẠI (chưa có mã); còn lại (chế độ chuẩn tắt,
   * hoặc đơn ký trước ngày bật chế độ chuẩn) → không có đơn pháp lý nên không có gì để gửi.
   */
  private buildKindGroups(
    prescription: PrescriptionWithItems | null,
    standardMode: boolean,
    mapping: Parameters<typeof resolvePrescriptionKind>[1],
  ): { kind: PrescriptionKind; nationalCode: string | null; documentId: string | null; items: PrescriptionWithItems['items'] }[] {
    if (!prescription || prescription.items.length === 0) return [];
    if (prescription.signedAt !== null) {
      return prescription.documents.map((doc) => ({ kind: doc.kind, nationalCode: doc.nationalCode, documentId: doc.id, items: prescription.items.filter((i) => i.documentId === doc.id) }));
    }
    if (!standardMode) return [];
    const withKind = prescription.items.map((i) => ({ item: i, kind: resolvePrescriptionKind({ isFreeText: i.drugId === null, controlType: i.controlType, isTraditional: i.isTraditional }, mapping) }));
    return groupByPrescriptionKind(withKind).map((g) => ({ kind: g.kind, nationalCode: null, documentId: null, items: g.items.map((x) => x.item) }));
  }
}
