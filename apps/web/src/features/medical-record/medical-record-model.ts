import type { ConsultationDetailResponse, EncounterInsurance, MedicalRecordParaclinicalResponse, PatientEncounterHistoryItem, RecordBundleConfig } from '@nexamed/shared';
import { formatDateTimeVn } from '../../shared/format/time';
import { recordBundleSummary } from '../../shared/print/record-bundle';
import { formatDateStringVi, toVietnamDateString, vietnameseWeekdayLabel } from '../encounter/follow-up-date';
import { TREATMENT_DIRECTION_LABEL } from '../encounter/treatment-plan';

/**
 * Hồ sơ bệnh án điện tử (docs/DECISIONS.md #269) — phần LOGIC THUẦN của tab "Hồ sơ bệnh án": ghép dữ liệu của MỘT lượt khám đã hoàn tất (lịch sử khám + chi tiết lượt khám + kết quả cận lâm sàng + hồ sơ
 * bệnh nhân) thành một `MedicalRecordView` dùng chung cho hai cách xem ("Theo mẫu Bộ Y tế" và "Theo trường dữ liệu"). Không có tiền/chi phí — tab này chỉ có dữ liệu lâm sàng.
 * Khung theo mẫu bệnh án ngoại trú MS 15/BV-01 (Thông tư 32/2023/TT-BYT, Phụ lục XXVIII): mục I–IV + "Tổng kết bệnh án".
 */

export type ParaclinicalResult = MedicalRecordParaclinicalResponse['results'][number];

export interface RecordField {
  label: string;
  value: string;
  /** Chiếm 2 ô của lưới (địa chỉ, người cần báo tin). */
  wide?: boolean;
}

/** Thông tin hành chính của bệnh nhân ĐÃ giải mã tên (dân tộc, quốc tịch, nghề nghiệp, địa chỉ) — do component resolve qua danh mục, model chỉ ghép. */
export interface RecordPatientInfo {
  /** Mã bệnh nhân — là "mã hồ sơ" ở đầu phiếu. */
  patientCode: string;
  fullName: string;
  /** `dd/mm/yyyy` — ô "2. Sinh ngày" của mẫu. */
  dob: string;
  /** Tuổi ("41 tuổi"…) — ô "Tuổi" riêng của mẫu, tách khỏi ngày sinh cho khỏi dính chữ. */
  age: string;
  gender: string;
  occupation: string;
  ethnicity: string;
  nationality: string;
  nationalId: string;
  phone: string;
  address: string;
  relative: string;
}

export interface RecordWho {
  name: string;
  time: string;
}
export interface FieldRow {
  field: string;
  value: string;
  who: RecordWho;
}
export interface FieldGroup {
  title: string;
  rows: FieldRow[];
}

export interface RecordDiagnosis {
  code: string;
  name: string;
  primary: boolean;
}

export interface MedicalRecordView {
  /** "Số lưu trữ" (mẫu MS 15/BV-01). */
  archiveNo: string | null;
  /** Mã phiếu khám — cũng là ô "Số ngoại trú" của mẫu. */
  encounterNo: string;
  /** Mã bệnh nhân = mã hồ sơ. */
  patientCode: string;
  /** Tên Loại tiếp nhận ("Khám mới"/"Tái khám"…) của lượt khám; `null` = chưa chọn hoặc danh mục chưa tải. */
  visitTypeLabel: string | null;
  /** "Từ ngày dd/mm/yyyy đến ngày dd/mm/yyyy" — mục IV.7; đến = ngày hẹn tái khám nếu có, không thì ngày khám. */
  treatmentPeriod: string;
  /** `dd/mm/yyyy` theo giờ Việt Nam — ngày khám. */
  visitDate: string;
  doctorName: string | null;
  /** Mốc ký BẢN GỐC (sớm nhất trong mọi mục đã ký); `null` nếu chưa có mục nào ký. */
  signedAt: string | null;
  /** Dòng vết đính chính ("Có đính chính: Chẩn đoán (05/09/2026)"); `null` = chưa đính chính lần nào. */
  amendNote: string | null;
  admin: RecordField[];
  /** 13 ô của mục I theo số thứ tự mẫu (có số ở nhãn). */
  sheetAdmin: RecordField[];
  reason: string;
  illness: string;
  preliminaryDiagnosis: string;
  generalExam: string;
  regionalExam: string;
  summary: string;
  prognosis: string;
  advice: string;
  planContent: string;
  vitals: RecordField[];
  personalHistoryNote: string;
  conditions: { code: string; name: string }[];
  familyHistory: string[];
  allergies: string[];
  diagnoses: RecordDiagnosis[];
  directions: string[];
  followUp: string | null;
  nationalCodes: string[];
  prescription: ConsultationDetailResponse['prescription'];
  cls: ParaclinicalResult[];
}

const DASH = '—';
const dashIfEmpty = (v: string | null | undefined): string => (v && v.trim() !== '' ? v.trim() : DASH);

/** Số thực kiểu Việt (dấu phẩy thập phân), bỏ phần thập phân thừa: 36,8 · 54. */
export function formatVnNumber(value: number, fractionDigits = 1): string {
  return value.toFixed(fractionDigits).replace('.', ',').replace(/,0+$/, '');
}

/** BMI = kg / m² (làm tròn 1 chữ số); `null` khi thiếu cân nặng hoặc chiều cao. */
export function computeBmi(weightGram: number | null, heightMm: number | null): number | null {
  if (weightGram === null || heightMm === null || heightMm <= 0) return null;
  const meters = heightMm / 1000;
  return Math.round((weightGram / 1000 / (meters * meters)) * 10) / 10;
}

/** 8 ô sinh hiệu của mục IV — thiếu chỉ số nào thì ô đó hiện gạch ngang (giữ đủ khung cho dễ đọc). */
export function buildVitals(vitals: ConsultationDetailResponse['vitalSigns']): RecordField[] {
  const bmi = vitals ? computeBmi(vitals.weightGram, vitals.heightMm) : null;
  const bp = vitals && vitals.bpSystolic !== null && vitals.bpDiastolic !== null ? `${vitals.bpSystolic}/${vitals.bpDiastolic} mmHg` : DASH;
  return [
    { label: 'Mạch', value: vitals?.pulse != null ? `${vitals.pulse} l/ph` : DASH },
    { label: 'Nhiệt độ', value: vitals?.temperatureC != null ? `${formatVnNumber(vitals.temperatureC)} °C` : DASH },
    { label: 'Huyết áp', value: bp },
    { label: 'Nhịp thở', value: vitals?.respiratoryRate != null ? `${vitals.respiratoryRate} l/ph` : DASH },
    { label: 'SpO₂', value: vitals?.spo2 != null ? `${vitals.spo2} %` : DASH },
    { label: 'Cân nặng', value: vitals?.weightGram != null ? `${formatVnNumber(vitals.weightGram / 1000)} kg` : DASH },
    { label: 'Chiều cao', value: vitals?.heightMm != null ? `${formatVnNumber(vitals.heightMm / 10, 0)} cm` : DASH },
    { label: 'BMI', value: bmi !== null ? formatVnNumber(bmi) : DASH },
  ];
}

/** "Đối tượng" + "Số thẻ BHYT" — chỉ có khi công tắc "Áp dụng BHYT" bật (`insurance` khác null); tắt thì không hiện dòng nào. */
function buildInsuranceFields(insurance: EncounterInsurance | null): RecordField[] {
  if (insurance === null) return [];
  const card = insurance.cardNo ?? (insurance.cardNoUnreadable ? 'Không đọc được' : DASH);
  return [
    { label: 'Đối tượng', value: insurance.selfPay ? 'Thu phí' : 'BHYT' },
    { label: 'Số thẻ BHYT', value: insurance.selfPay ? DASH : card },
  ];
}

/** Các ô hành chính của mục I, đúng thứ tự mockup đã duyệt. Cột "Chi nhánh" chỉ có khi công ty có từ 2 chi nhánh. */
export function buildAdminFields(
  patient: RecordPatientInfo,
  encounter: { archiveNo: string | null; encounterNo: string; checkedInAt: string; doctorName: string | null; departmentName: string | null; branchName: string | null; insurance: EncounterInsurance | null },
  showBranch: boolean,
): RecordField[] {
  return [
    { label: 'Số lưu trữ', value: dashIfEmpty(encounter.archiveNo) },
    { label: 'Mã phiếu khám', value: encounter.encounterNo },
    { label: 'Họ và tên', value: dashIfEmpty(patient.fullName) },
    { label: 'Sinh ngày', value: dashIfEmpty(patient.dob) },
    { label: 'Tuổi', value: dashIfEmpty(patient.age) },
    { label: 'Giới tính', value: dashIfEmpty(patient.gender) },
    { label: 'Nghề nghiệp', value: dashIfEmpty(patient.occupation) },
    { label: 'Dân tộc', value: dashIfEmpty(patient.ethnicity) },
    { label: 'Quốc tịch', value: dashIfEmpty(patient.nationality) },
    { label: 'Số CCCD', value: dashIfEmpty(patient.nationalId) },
    { label: 'Điện thoại', value: dashIfEmpty(patient.phone) },
    ...buildInsuranceFields(encounter.insurance),
    { label: 'Địa chỉ', value: dashIfEmpty(patient.address), wide: true },
    { label: 'Khi cần báo tin cho', value: dashIfEmpty(patient.relative), wide: true },
    ...(showBranch ? [{ label: 'Chi nhánh', value: dashIfEmpty(encounter.branchName) }] : []),
    { label: 'Khoa · Phòng', value: dashIfEmpty(encounter.departmentName) },
    { label: 'Bác sĩ khám', value: dashIfEmpty(encounter.doctorName) },
    { label: 'Vào khám lúc', value: formatDateTimeVn(encounter.checkedInAt) },
  ];
}

/**
 * Mục I "Hành chính" đủ 13 ô theo số thứ tự mẫu MS 15/BV-01. Hệ thống chưa lưu "Nơi làm việc" và "Chẩn đoán của nơi giới thiệu" nên hiện gạch ngang; "Đối tượng" suy ra từ thẻ BHYT của lượt khám
 * (công tắc "Áp dụng BHYT" tắt thì để trống) — chủ dự án chốt 30/10/2026, không thêm trường mới.
 */
export function buildSheetAdminFields(patient: RecordPatientInfo, encounter: { checkedInAt: string; insurance: EncounterInsurance | null }): RecordField[] {
  const ins = encounter.insurance;
  const hasCard = ins !== null && !ins.selfPay && (ins.cardNo !== null || ins.cardNoUnreadable);
  const objectLabel = ins === null ? DASH : hasCard ? 'BHYT' : 'Thu phí';
  const validTo = ins?.validTo ? ` · đến ${formatDateStringVi(ins.validTo.slice(0, 10))}` : '';
  const card = ins === null || ins.selfPay ? DASH : ins.cardNo ? `${ins.cardNo}${validTo}` : ins.cardNoUnreadable ? 'Không đọc được' : DASH;
  return [
    { label: '1. Họ và tên (in hoa)', value: dashIfEmpty(patient.fullName).toLocaleUpperCase('vi-VN'), wide: true },
    { label: '2. Sinh ngày', value: dashIfEmpty(patient.dob) },
    { label: 'Tuổi', value: dashIfEmpty(patient.age) },
    { label: '3. Giới', value: dashIfEmpty(patient.gender) },
    { label: '4. Nghề nghiệp', value: dashIfEmpty(patient.occupation) },
    { label: '5. Dân tộc', value: dashIfEmpty(patient.ethnicity) },
    { label: '6. Ngoại kiều', value: dashIfEmpty(patient.nationality) },
    { label: '7. Địa chỉ', value: dashIfEmpty(patient.address), wide: true },
    { label: '8. Nơi làm việc', value: DASH },
    { label: '9. Đối tượng', value: objectLabel },
    { label: '10. BHYT giá trị đến · Số thẻ BHYT', value: card, wide: true },
    { label: '11. Người nhà khi cần báo tin', value: dashIfEmpty(patient.relative), wide: true },
    { label: '12. Đến khám bệnh lúc', value: formatDateTimeVn(encounter.checkedInAt) },
    { label: '13. Chẩn đoán của nơi giới thiệu', value: DASH, wide: true },
  ];
}

const NOTE_SECTION_LABEL: Record<string, string> = {
  reasonForVisit: 'Lý do khám',
  illnessProgress: 'Quá trình bệnh lý',
  preliminaryDiagnosis: 'Chẩn đoán sơ bộ',
  generalExam: 'Khám toàn thân',
  regionalExam: 'Khám bộ phận',
  plan: 'Nội dung điều trị',
  conclusion: 'Kết luận',
  doctorAdvice: 'Lời dặn',
  summary: 'Tóm tắt bệnh án',
  prognosis: 'Tình trạng người bệnh khi kết thúc khám',
};

/** Mốc ký bản gốc + dòng vết đính chính, tính từ mọi mục lâm sàng của lượt khám. */
export function summarizeSignatures(detail: ConsultationDetailResponse): { signedAt: string | null; amendNote: string | null } {
  const signed: string[] = [];
  const amended: { label: string; at: string }[] = [];
  const consider = (label: string, signedAt: string | null, amendmentReason: string | null, supersedesId: string | null) => {
    if (signedAt === null) return;
    // Bản đính chính mang `supersedesId`; mốc ký GỐC là của các bản không phải đính chính.
    if (supersedesId === null && amendmentReason === null) signed.push(signedAt);
    else amended.push({ label, at: signedAt });
  };
  for (const [key, value] of Object.entries(detail.clinicalNote)) {
    if (key === 'treatmentPlan' || value === null) continue;
    const section = value as { signedAt: string | null; amendmentReason: string | null; supersedesId: string | null };
    consider(NOTE_SECTION_LABEL[key] ?? key, section.signedAt, section.amendmentReason, section.supersedesId);
  }
  const plan = detail.clinicalNote.treatmentPlan;
  if (plan) consider('Điều trị', plan.signedAt, plan.amendmentReason, plan.supersedesId);
  for (const d of detail.diagnoses) consider('Chẩn đoán', d.signedAt, d.amendmentReason, d.supersedesId);
  if (detail.prescription) consider('Đơn thuốc', detail.prescription.signedAt, detail.prescription.amendmentReason, detail.prescription.supersedesId);

  const signedAt = signed.length > 0 ? [...signed].sort()[0]! : detail.encounter.completedAt;
  if (amended.length === 0) return { signedAt, amendNote: null };
  const labels = [...new Set(amended.map((a) => a.label))];
  const latest = [...amended].sort((a, b) => (a.at < b.at ? 1 : -1))[0]!;
  return { signedAt, amendNote: `Có đính chính: ${labels.join(', ')} (mới nhất ${formatDateStringVi(toVietnamDateString(latest.at))})` };
}

export function buildMedicalRecordView(input: {
  item: PatientEncounterHistoryItem;
  detail: ConsultationDetailResponse;
  paraclinical: ParaclinicalResult[];
  patient: RecordPatientInfo;
  showBranch: boolean;
  /** Tên Loại tiếp nhận của lượt khám (đã tra danh mục) — `null` khi chưa chọn hoặc danh mục chưa tải. */
  visitTypeLabel?: string | null;
}): MedicalRecordView {
  const { item, detail, paraclinical, patient, showBranch, visitTypeLabel = null } = input;
  const note = detail.clinicalNote;
  const text = (section: { content: string } | null | undefined): string => section?.content.trim() ?? '';
  const { signedAt, amendNote } = summarizeSignatures(detail);
  const plan = note.treatmentPlan;
  const followUpDate = plan?.directions.includes('FOLLOW_UP') ? plan.followUpDate : null;
  const visitDate = formatDateTimeVn(item.checkedInAt).slice(0, 10);

  return {
    archiveNo: item.archiveNo ?? detail.encounter.archiveNo,
    encounterNo: item.encounterNo,
    patientCode: patient.patientCode,
    visitTypeLabel,
    treatmentPeriod: `Từ ngày ${visitDate} đến ngày ${followUpDate ? formatDateStringVi(followUpDate) : visitDate}`,
    visitDate,
    doctorName: item.doctorName,
    signedAt,
    amendNote,
    admin: buildAdminFields(
      patient,
      {
        archiveNo: item.archiveNo ?? detail.encounter.archiveNo,
        encounterNo: item.encounterNo,
        checkedInAt: item.checkedInAt,
        doctorName: item.doctorName,
        departmentName: item.departmentName,
        branchName: item.branchName,
        insurance: detail.insurance,
      },
      showBranch,
    ),
    sheetAdmin: buildSheetAdminFields(patient, { checkedInAt: item.checkedInAt, insurance: detail.insurance }),
    reason: text(note.reasonForVisit) || (detail.encounter.chiefComplaint ?? '').trim(),
    illness: text(note.illnessProgress),
    preliminaryDiagnosis: text(note.preliminaryDiagnosis),
    generalExam: text(note.generalExam),
    regionalExam: text(note.regionalExam),
    summary: text(note.summary),
    prognosis: text(note.prognosis),
    advice: text(note.doctorAdvice),
    planContent: text(note.plan),
    vitals: buildVitals(detail.vitalSigns),
    personalHistoryNote: (detail.patient.personalHistory ?? '').trim(),
    conditions: detail.patient.conditions.map((c) => ({ code: c.icd10Code, name: c.icd10Name })),
    familyHistory: detail.patient.familyHistoryRows.map((f) => `${f.relationLabel}: ${f.icd10Code} ${f.icd10Name}`),
    allergies: detail.patient.allergens.map((a) => a.name),
    diagnoses: [...detail.diagnoses]
      .sort((a, b) => Number(b.type === 'PRIMARY') - Number(a.type === 'PRIMARY'))
      .map((d) => ({ code: d.icd10Code, name: d.icd10Name, primary: d.type === 'PRIMARY' })),
    directions: (plan?.directions ?? []).map((d) => TREATMENT_DIRECTION_LABEL[d]),
    followUp: followUpDate ? `${vietnameseWeekdayLabel(followUpDate)}, ${formatDateStringVi(followUpDate)}` : null,
    nationalCodes: (detail.prescription?.documents ?? []).map((d) => d.nationalCode),
    prescription: detail.prescription,
    cls: paraclinical,
  };
}

/** "Bộ hồ sơ in (1 tệp PDF)": tờ khám + N phiếu kết quả + M đơn thuốc — chỉ kể thứ thật sự có VÀ được bản mẫu in Bệnh án bật (#272). */
export function bundleSummary(view: Pick<MedicalRecordView, 'cls' | 'prescription'>, bundle?: RecordBundleConfig): string {
  const prescriptions = view.prescription && view.prescription.signedAt ? Math.max(view.prescription.documents.length, 1) : 0;
  return recordBundleSummary({ paraclinical: view.cls.length, prescriptions }, bundle);
}

/** Bảng "Theo trường dữ liệu": mỗi trường hệ thống đang lưu của lượt khám kèm người ghi và thời điểm (không hiện tên bảng/cột kỹ thuật). */
export function buildFieldGroups(view: MedicalRecordView, signerName: string | null): FieldGroup[] {
  const adminOf = (label: string): string => view.admin.find((f) => f.label === label)?.value ?? DASH;
  const entryTime = adminOf('Vào khám lúc');
  const signedTime = view.signedAt ? formatDateTimeVn(view.signedAt) : DASH;
  const doctor: RecordWho = { name: signerName ?? 'Bác sĩ', time: view.amendNote ? `${signedTime} · ${view.amendNote}` : signedTime };
  const doctorPlain: RecordWho = { name: signerName ?? 'Bác sĩ', time: signedTime };
  const system: RecordWho = { name: 'Hệ thống', time: entryTime };
  const reception: RecordWho = { name: 'Lễ tân', time: entryTime };
  const nurse: RecordWho = { name: 'Điều dưỡng', time: entryTime };
  const profile: RecordWho = { name: 'Hồ sơ bệnh nhân', time: '' };
  // Mục tuỳ chọn bác sĩ chưa ghi: không có người/thời điểm để hiện.
  const optional: RecordWho = { name: '—', time: '' };
  const row = (field: string, value: string | null | undefined, who: RecordWho): FieldRow => ({ field, value: dashIfEmpty(value), who });
  const adminRow = (label: string, who: RecordWho): FieldRow => row(label, adminOf(label), who);

  const groups: FieldGroup[] = [
    {
      title: 'Lượt khám',
      rows: [
        row('Số ngoại trú (mã phiếu khám)', view.encounterNo, system),
        row('Số lưu trữ', view.archiveNo, system),
        row('Hồ sơ (mã bệnh nhân)', view.patientCode, system),
        row('Loại khám', view.visitTypeLabel, reception),
        adminRow('Vào khám lúc', reception),
        adminRow('Bác sĩ khám', reception),
        adminRow('Khoa · Phòng', reception),
        ...(view.admin.some((f) => f.label === 'Chi nhánh') ? [adminRow('Chi nhánh', system)] : []),
      ],
    },
    {
      title: 'Hành chính bệnh nhân',
      rows: [
        'Họ và tên',
        'Sinh ngày',
        'Tuổi',
        'Giới tính',
        'Nghề nghiệp',
        'Dân tộc',
        'Quốc tịch',
        'Số CCCD',
        'Điện thoại',
        'Địa chỉ',
        'Khi cần báo tin cho',
      ].map((label) => adminRow(label, profile)),
    },
    { title: 'Sinh hiệu', rows: view.vitals.map((v) => row(v.label, v.value, v.label === 'BMI' ? { name: 'Hệ thống tính', time: '' } : nurse)) },
    {
      title: 'Ghi chú khám',
      rows: [
        row('Lý do đến khám', view.reason, doctorPlain),
        row('Quá trình bệnh lý', view.illness, doctorPlain),
        row('Khám toàn thân', view.generalExam, doctorPlain),
        row('Khám các bộ phận', view.regionalExam, doctorPlain),
        row('Tóm tắt bệnh án', view.summary, view.summary ? doctor : optional),
        row('Tình trạng người bệnh khi kết thúc khám', view.prognosis, view.prognosis ? doctor : optional),
        row('Lời dặn bác sĩ', view.advice, doctor),
      ],
    },
    {
      title: 'Chẩn đoán',
      rows: [
        row('Chẩn đoán sơ bộ', view.preliminaryDiagnosis, doctorPlain),
        ...view.diagnoses.map((d) => row(d.primary ? 'Chẩn đoán chính' : 'Chẩn đoán kèm theo', `${d.code} — ${d.name}`, doctor)),
      ],
    },
    {
      title: 'Cận lâm sàng',
      rows: view.cls.map((r) => row(r.serviceName, r.conclusionText ?? r.descriptionText, { name: 'Duyệt kết quả', time: formatDateTimeVn(r.signedAt) })),
    },
    {
      title: 'Điều trị và đơn thuốc',
      rows: [
        row('Hướng điều trị', view.directions.join('; '), doctor),
        row('Nội dung điều trị', view.planContent, doctor),
        row('Hẹn tái khám', view.followUp, doctor),
        ...view.nationalCodes.map((code, i) => row(view.nationalCodes.length > 1 ? `Mã đơn quốc gia ${i + 1}` : 'Mã đơn quốc gia', code, doctor)),
        ...(view.prescription?.items ?? []).map((m, i) => row(`Thuốc ${i + 1}`, `${m.drugName} · ${m.quantity}${m.unitCode ? ` ${m.unitCode}` : ''}`, doctor)),
      ],
    },
  ];

  // Nhóm chỉ có dòng "Chưa có" của chính nó (ví dụ không có cận lâm sàng) thì bỏ hẳn, tránh bảng rỗng.
  return groups.filter((g) => g.rows.length > 0);
}
